import { invoke } from "@tauri-apps/api/core";
import type { JiraIssueDevelopment } from "../domain/jira-development";
import { getAppSettings } from "./settings-repository";
import { getDatabase } from "./database";

export async function syncJiraIssueDevelopment(
  workItemId: string,
  jiraLinkId: string,
  issueKey: string,
  cwds: string[],
): Promise<JiraIssueDevelopment> {
  const settings = await getAppSettings();
  if (!settings.jira_url || !settings.jira_email) {
    throw new Error("Settings에서 Jira 사이트 URL과 계정 이메일을 설정해주세요.");
  }
  const result = await invoke<JiraIssueDevelopment>("fetch_jira_issue_development", {
    jiraUrl: settings.jira_url,
    jiraEmail: settings.jira_email,
    issueKey,
    cwds,
  });

  const database = await getDatabase();
  const syncedAt = new Date().toISOString();
  await database.execute(
    `UPDATE work_item_links
     SET external_id = $1, external_url = $2, label = $3, status = $4, last_synced_at = $5
     WHERE id = $6 AND work_item_id = $7 AND kind = 'jira'`,
    [
      result.issue.key,
      result.issue.url,
      `${result.issue.key} · ${result.issue.summary}`,
      result.issue.status,
      syncedAt,
      jiraLinkId,
      workItemId,
    ],
  );

  for (const pullRequest of result.pullRequests) {
    await database.execute(
      `INSERT OR IGNORE INTO work_item_links (
        id, work_item_id, kind, external_id, external_url, label, status, last_synced_at, created_at
      ) VALUES ($1, $2, 'github_pr', $3, $4, $5, $6, $7, $7)`,
      [
        crypto.randomUUID(),
        workItemId,
        `${pullRequest.repository}#${pullRequest.number}`,
        pullRequest.url,
        `${pullRequest.repository}#${pullRequest.number} · ${pullRequest.title}`,
        pullRequest.status.toLocaleLowerCase(),
        syncedAt,
      ],
    );
  }

  for (const commit of result.commits) {
    await database.execute(
      `INSERT OR IGNORE INTO work_item_links (
        id, work_item_id, kind, external_id, external_url, label, status, last_synced_at, created_at
      ) VALUES ($1, $2, 'github_commit', $3, $4, $5, 'linked', $6, $6)`,
      [
        crypto.randomUUID(),
        workItemId,
        `${commit.repository}@${commit.sha.slice(0, 7)}`,
        commit.url,
        `${commit.sha.slice(0, 7)} · ${commit.message}`,
        syncedAt,
      ],
    );
  }

  return result;
}
