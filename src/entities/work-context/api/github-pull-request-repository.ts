import { invoke } from "@tauri-apps/api/core";
import type {
  GitHubPullRequest,
  PullRequestScanResult,
  PullRequestTaskLink,
} from "../model/github-pull-request";
import { normalizeSourceScope, sourceDefinitions, stableScopeKey } from "../model/source-capability";
import { listAiSessions } from "./ai-session-repository";
import { getDatabase } from "./database";
import { runScopedSourceRefresh } from "./source-sync-repository";

interface PullRequestRow {
  repository: string;
  repo_path: string;
  number: number;
  title: string;
  url: string;
  head_ref_name: string;
  base_ref_name: string;
  is_draft: number;
  updated_at: string;
  author_login: string | null;
  session_match_count: number;
  authored_by_viewer: number;
  review_requested: number;
  discovered_at: string;
}

function toPullRequest(row: PullRequestRow): GitHubPullRequest {
  return {
    repository: row.repository,
    repoPath: row.repo_path,
    number: row.number,
    title: row.title,
    url: row.url,
    headRefName: row.head_ref_name,
    baseRefName: row.base_ref_name,
    isDraft: row.is_draft === 1,
    updatedAt: row.updated_at,
    authorLogin: row.author_login,
    sessionMatchCount: row.session_match_count,
    authoredByViewer: row.authored_by_viewer === 1,
    reviewRequested: row.review_requested === 1,
    discoveredAt: row.discovered_at,
  };
}

export async function listCachedPullRequests(): Promise<GitHubPullRequest[]> {
  const database = await getDatabase();
  const rows = await database.select<PullRequestRow[]>(`
    SELECT repository, repo_path, number, title, url, head_ref_name, base_ref_name,
      is_draft, updated_at, author_login, session_match_count, authored_by_viewer,
      review_requested, discovered_at
    FROM github_pull_requests
    ORDER BY session_match_count DESC, updated_at DESC
  `);
  return rows.map(toPullRequest);
}

export async function refreshPullRequestsFromSessions(options: { force?: boolean } = {}): Promise<PullRequestScanResult> {
  return (await refreshPullRequestsWithScope(options)).result;
}

export async function refreshPullRequestsWithScope(options: { force?: boolean } = {}) {
  const sessions = await listAiSessions();
  const cwds = sessions.map((session) => session.cwd).filter((cwd): cwd is string => Boolean(cwd));
  const scope = normalizeSourceScope("github", stableScopeKey(cwds));
  const result = await runScopedSourceRefresh({
    source: "github",
    scopeKey: scope.scopeKey,
    ttlMs: sourceDefinitions.github.ttlMs,
    force: options.force,
    refresh: async () => {
      const data = await performPullRequestRefresh(cwds);
      const partial = data.repositoriesSucceeded < data.repositoriesScanned;
      return {
        data,
        itemCount: data.pullRequests.length,
        status: partial ? "partial" as const : "fresh" as const,
        errorCategory: partial ? "partial-scan" : null,
        errorSummary: partial ? data.warnings.join(" ").slice(0, 240) : null,
      };
    },
  });
  if (result.data) return { result: result.data, scopeKey: scope.scopeKey };
  const cached = await listCachedPullRequests();
  return {
    result: {
      pullRequests: cached.map(({ discoveredAt: _, ...pullRequest }) => pullRequest),
      repositoriesScanned: new Set(cached.map((pullRequest) => pullRequest.repository)).size,
      repositoriesSucceeded: new Set(cached.map((pullRequest) => pullRequest.repository)).size,
      warnings: [],
    },
    scopeKey: scope.scopeKey,
  };
}

async function performPullRequestRefresh(cwds: string[]): Promise<PullRequestScanResult> {
  const result = await invoke<PullRequestScanResult>("scan_session_pull_requests", { cwds });

  if (result.repositoriesScanned > 0 && result.repositoriesSucceeded === 0 && result.pullRequests.length === 0) {
    throw new Error(result.warnings[0] || "GitHub PR을 불러오지 못했습니다.");
  }

  const database = await getDatabase();
  const discoveredAt = new Date().toISOString();
  const currentPullRequests = await database.select<Array<{ repository: string; number: number }>>(
    "SELECT repository, number FROM github_pull_requests",
  );
  const nextPullRequests = new Set(result.pullRequests.map((item) => `${item.repository}\u001f${item.number}`));
  for (const pullRequest of result.pullRequests) {
    await database.execute(
      `INSERT INTO github_pull_requests (
        repository, number, repo_path, title, url, head_ref_name, base_ref_name,
        is_draft, updated_at, author_login, session_match_count, authored_by_viewer,
        review_requested, discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT(repository, number) DO UPDATE SET
        repo_path = excluded.repo_path, title = excluded.title, url = excluded.url,
        head_ref_name = excluded.head_ref_name, base_ref_name = excluded.base_ref_name,
        is_draft = excluded.is_draft, updated_at = excluded.updated_at,
        author_login = excluded.author_login, session_match_count = excluded.session_match_count,
        authored_by_viewer = excluded.authored_by_viewer,
        review_requested = excluded.review_requested, discovered_at = excluded.discovered_at`,
      [
        pullRequest.repository,
        pullRequest.number,
        pullRequest.repoPath,
        pullRequest.title,
        pullRequest.url,
        pullRequest.headRefName,
        pullRequest.baseRefName,
        pullRequest.isDraft ? 1 : 0,
        pullRequest.updatedAt,
        pullRequest.authorLogin,
        pullRequest.sessionMatchCount,
        pullRequest.authoredByViewer ? 1 : 0,
        pullRequest.reviewRequested ? 1 : 0,
        discoveredAt,
      ],
    );
  }
  if (result.repositoriesSucceeded === result.repositoriesScanned) {
    for (const current of currentPullRequests) {
      if (!nextPullRequests.has(`${current.repository}\u001f${current.number}`)) {
        await database.execute(
          "DELETE FROM github_pull_requests WHERE repository = $1 AND number = $2",
          [current.repository, current.number],
        );
      }
    }
  }
  return result;
}

export async function listPullRequestTaskLinks(): Promise<PullRequestTaskLink[]> {
  const database = await getDatabase();
  const rows = await database.select<Array<{
    url: string;
    work_item_id: string;
    work_item_title: string;
  }>>(
    `SELECT links.external_url AS url, links.work_item_id, items.title AS work_item_title
     FROM work_item_links links
     JOIN work_items items ON items.id = links.work_item_id
     WHERE links.kind = 'github_pr' AND links.external_url IS NOT NULL`,
  );
  return rows.map((row) => ({
    url: row.url,
    workItemId: row.work_item_id,
    workItemTitle: row.work_item_title,
  }));
}
