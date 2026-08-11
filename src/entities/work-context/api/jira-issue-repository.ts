import { invoke } from "@tauri-apps/api/core";
import type { AssignedJiraIssuesResult, JiraIssue, JiraTaskLink } from "../model/jira-issue";
import { sourceDefinitions } from "../model/source-capability";
import { getAppSettings } from "./settings-repository";
import { getDatabase } from "./database";
import { runScopedSourceRefresh } from "./source-sync-repository";

interface JiraIssueRow {
  issue_key: string;
  summary: string;
  status: string;
  status_category: string;
  priority: string | null;
  project_key: string;
  project_name: string;
  due_date: string | null;
  updated_at: string;
  url: string;
  discovered_at: string;
}

function toIssue(row: JiraIssueRow): JiraIssue {
  return {
    key: row.issue_key,
    summary: row.summary,
    status: row.status,
    statusCategory: row.status_category,
    priority: row.priority,
    projectKey: row.project_key,
    projectName: row.project_name,
    dueDate: row.due_date,
    updatedAt: row.updated_at,
    url: row.url,
    discoveredAt: row.discovered_at,
  };
}

export async function listCachedJiraIssues(): Promise<JiraIssue[]> {
  const database = await getDatabase();
  const rows = await database.select<JiraIssueRow[]>(`
    SELECT issue_key, summary, status, status_category, priority, project_key,
      project_name, due_date, updated_at, url, discovered_at
    FROM jira_issues ORDER BY updated_at DESC
  `);
  return rows.map(toIssue);
}

export async function refreshAssignedJiraIssues(options: { force?: boolean } = {}): Promise<AssignedJiraIssuesResult> {
  const result = await runScopedSourceRefresh({
    source: "jira",
    scopeKey: "global",
    ttlMs: sourceDefinitions.jira.ttlMs,
    force: options.force,
    refresh: async () => {
      const data = await performRefresh();
      return {
        data,
        itemCount: data.issues.length,
        status: data.truncated ? "partial" as const : "fresh" as const,
        errorCategory: data.truncated ? "result-truncated" : null,
        errorSummary: data.truncated ? "Jira 결과가 500개로 제한되어 기존 캐시를 보존했습니다." : null,
      };
    },
  });
  if (result.data) return result.data;
  const issues = await listCachedJiraIssues();
  return { issues, truncated: false };
}

async function performRefresh(): Promise<AssignedJiraIssuesResult> {
  const settings = await getAppSettings();
  if (!settings.jira_url || !settings.jira_email) {
    throw new Error("Settings에서 Jira 사이트 URL과 계정 이메일을 설정해주세요.");
  }
  const result = await invoke<AssignedJiraIssuesResult>("fetch_assigned_jira_issues", {
    jiraUrl: settings.jira_url,
    jiraEmail: settings.jira_email,
  });
  const database = await getDatabase();
  const discoveredAt = new Date().toISOString();
  const currentIssues = await database.select<Array<{ issue_key: string }>>("SELECT issue_key FROM jira_issues");
  const nextIssueKeys = new Set(result.issues.map((issue) => issue.key));
  for (const issue of result.issues) {
    await database.execute(
      `INSERT INTO jira_issues (
        issue_key, summary, status, status_category, priority, project_key,
        project_name, due_date, updated_at, url, discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT(issue_key) DO UPDATE SET
        summary = excluded.summary, status = excluded.status,
        status_category = excluded.status_category, priority = excluded.priority,
        project_key = excluded.project_key, project_name = excluded.project_name,
        due_date = excluded.due_date, updated_at = excluded.updated_at,
        url = excluded.url, discovered_at = excluded.discovered_at`,
      [
        issue.key, issue.summary, issue.status, issue.statusCategory, issue.priority,
        issue.projectKey, issue.projectName, issue.dueDate, issue.updatedAt, issue.url, discoveredAt,
      ],
    );
  }
  if (!result.truncated) {
    for (const current of currentIssues) {
      if (!nextIssueKeys.has(current.issue_key)) {
        await database.execute("DELETE FROM jira_issues WHERE issue_key = $1", [current.issue_key]);
      }
    }
  }
  return result;
}

export async function listJiraTaskLinks(): Promise<JiraTaskLink[]> {
  const database = await getDatabase();
  const rows = await database.select<Array<{
    issue_key: string;
    work_item_id: string;
    work_item_title: string;
  }>>(
    `SELECT links.external_id AS issue_key, links.work_item_id, items.title AS work_item_title
     FROM work_item_links links
     JOIN work_items items ON items.id = links.work_item_id
     WHERE links.kind = 'jira' AND links.external_id IS NOT NULL`,
  );
  return rows.map((row) => ({
    issueKey: row.issue_key,
    workItemId: row.work_item_id,
    workItemTitle: row.work_item_title,
  }));
}
