import { invoke } from "@tauri-apps/api/core";
import type {
  GitHubPullRequest,
  PullRequestScanResult,
  PullRequestTaskLink,
} from "../domain/github-pull-request";
import { listAiSessions } from "./ai-session-repository";
import { getDatabase } from "./database";

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
    discoveredAt: row.discovered_at,
  };
}

let activeRefresh: Promise<PullRequestScanResult> | null = null;

export async function listCachedPullRequests(): Promise<GitHubPullRequest[]> {
  const database = await getDatabase();
  const rows = await database.select<PullRequestRow[]>(`
    SELECT repository, repo_path, number, title, url, head_ref_name, base_ref_name,
      is_draft, updated_at, author_login, session_match_count, discovered_at
    FROM github_pull_requests
    ORDER BY session_match_count DESC, updated_at DESC
  `);
  return rows.map(toPullRequest);
}

export function refreshPullRequestsFromSessions(): Promise<PullRequestScanResult> {
  activeRefresh ??= performPullRequestRefresh().finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

async function performPullRequestRefresh(): Promise<PullRequestScanResult> {
  const sessions = await listAiSessions();
  const cwds = sessions.map((session) => session.cwd).filter((cwd): cwd is string => Boolean(cwd));
  const result = await invoke<PullRequestScanResult>("scan_session_pull_requests", { cwds });

  if (result.repositoriesScanned > 0 && result.repositoriesSucceeded === 0) {
    throw new Error(result.warnings[0] || "GitHub PR을 불러오지 못했습니다.");
  }

  const database = await getDatabase();
  const discoveredAt = new Date().toISOString();
  await database.execute("DELETE FROM github_pull_requests");
  for (const pullRequest of result.pullRequests) {
    await database.execute(
      `INSERT INTO github_pull_requests (
        repository, number, repo_path, title, url, head_ref_name, base_ref_name,
        is_draft, updated_at, author_login, session_match_count, discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
        discoveredAt,
      ],
    );
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
