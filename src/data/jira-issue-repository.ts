import { invoke } from "@tauri-apps/api/core";
import type { AssignedJiraIssuesResult, JiraIssue, JiraTaskLink } from "../domain/jira-issue";
import { getAppSettings } from "./settings-repository";
import { getDatabase } from "./database";

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

let activeRefresh: Promise<AssignedJiraIssuesResult> | null = null;

export async function listCachedJiraIssues(): Promise<JiraIssue[]> {
  const database = await getDatabase();
  const rows = await database.select<JiraIssueRow[]>(`
    SELECT issue_key, summary, status, status_category, priority, project_key,
      project_name, due_date, updated_at, url, discovered_at
    FROM jira_issues ORDER BY updated_at DESC
  `);
  return rows.map(toIssue);
}

export function refreshAssignedJiraIssues(): Promise<AssignedJiraIssuesResult> {
  activeRefresh ??= performRefresh().finally(() => { activeRefresh = null; });
  return activeRefresh;
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
  await database.execute("DELETE FROM jira_issues");
  for (const issue of result.issues) {
    await database.execute(
      `INSERT INTO jira_issues (
        issue_key, summary, status, status_category, priority, project_key,
        project_name, due_date, updated_at, url, discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        issue.key, issue.summary, issue.status, issue.statusCategory, issue.priority,
        issue.projectKey, issue.projectName, issue.dueDate, issue.updatedAt, issue.url, discoveredAt,
      ],
    );
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
