import type { WorkItemLink, WorkItemLinkKind } from "../domain/work-item-link";
import { getDatabase } from "./database";

interface WorkItemLinkRow {
  id: string;
  work_item_id: string;
  kind: WorkItemLinkKind;
  external_id: string | null;
  external_url: string | null;
  label: string;
  status: string;
  last_synced_at: string | null;
  created_at: string;
}

function toLink(row: WorkItemLinkRow): WorkItemLink {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    kind: row.kind,
    externalId: row.external_id,
    externalUrl: row.external_url,
    label: row.label,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

export async function listWorkItemLinks(workItemId: string): Promise<WorkItemLink[]> {
  const database = await getDatabase();
  const rows = await database.select<WorkItemLinkRow[]>(
    `SELECT id, work_item_id, kind, external_id, external_url, label, status, last_synced_at, created_at
     FROM work_item_links WHERE work_item_id = $1 ORDER BY created_at`,
    [workItemId],
  );
  return rows.map(toLink);
}

export async function createWorkItemLink(
  workItemId: string,
  kind: WorkItemLinkKind,
  reference: string,
): Promise<string> {
  const value = reference.trim();
  if (!value) throw new Error("연결할 Jira 또는 GitHub 정보를 입력해주세요.");

  const isUrl = /^https?:\/\//i.test(value);
  if (kind !== "jira" && !isUrl) throw new Error("GitHub URL을 입력해주세요.");
  const externalId = kind === "jira"
    ? extractJiraKey(value)
    : kind === "github_pr"
      ? githubPrId(value)
      : githubCommitId(value);
  if (kind === "jira" && !externalId) throw new Error("CGKR-123 형식의 Jira 이슈 키 또는 Jira URL을 입력해주세요.");
  const label = externalId || value;
  const id = crypto.randomUUID();
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO work_item_links (id, work_item_id, kind, external_id, external_url, label, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, workItemId, kind, externalId, isUrl ? value : null, label, new Date().toISOString()],
  );
  return id;
}

export async function deleteWorkItemLink(id: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("DELETE FROM work_item_links WHERE id = $1", [id]);
}

export function extractJiraKey(value: string): string | null {
  return value.match(/(?:^|\/browse\/)([A-Z][A-Z0-9]+-\d+)(?:$|[/?#])/i)?.[1]?.toUpperCase() || null;
}

function githubPrId(value: string): string | null {
  const match = value.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  return match ? `${match[1]}/${match[2]}#${match[3]}` : null;
}

function githubCommitId(value: string): string | null {
  const match = value.match(/github\.com\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]+)/i);
  return match ? `${match[1]}/${match[2]}@${match[3].slice(0, 7)}` : null;
}
