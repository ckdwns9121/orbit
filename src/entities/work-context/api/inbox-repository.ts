import type {
  InboxCandidate,
  InboxCandidateInput,
  InboxTaskDraft,
} from "../model/work-continuity";
import type Database from "@tauri-apps/plugin-sql";
import { getDatabase } from "./database";
import { createWorkItem } from "./work-item-repository";

interface InboxCandidateRow {
  id: string;
  source: InboxCandidate["source"];
  external_key: string;
  external_version: string;
  title: string;
  goal: string | null;
  external_url: string | null;
  metadata_json: string;
  status: InboxCandidate["status"];
  linked_work_item_id: string | null;
  ignored_version: string | null;
  discovered_at: string;
  updated_at: string;
}

function boundedMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const blocked = /(token|secret|authorization|cookie|prompt|message|body|text)/i;
  return Object.fromEntries(Object.entries(metadata)
    .filter(([key]) => !blocked.test(key))
    .slice(0, 20)
    .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 300) : value]));
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapRow(row: InboxCandidateRow): InboxCandidate {
  return {
    id: row.id,
    source: row.source,
    externalKey: row.external_key,
    externalVersion: row.external_version,
    title: row.title,
    goal: row.goal,
    externalUrl: row.external_url,
    metadata: parseMetadata(row.metadata_json),
    status: row.status,
    linkedWorkItemId: row.linked_work_item_id,
    ignoredVersion: row.ignored_version,
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at,
  };
}

const fields = `id, source, external_key, external_version, title, goal, external_url,
  metadata_json, status, linked_work_item_id, ignored_version, discovered_at, updated_at`;

export interface InboxCandidatePage {
  items: InboxCandidate[];
  total: number;
  limit: number;
  offset: number;
}

type InboxReadDatabase = Pick<Database, "select">;

function normalizedPage(limit = 100, offset = 0) {
  return {
    limit: Math.min(Math.max(Math.trunc(limit), 1), 200),
    offset: Math.max(Math.trunc(offset), 0),
  };
}

export async function upsertInboxCandidate(input: InboxCandidateInput): Promise<string> {
  if (!input.externalKey.trim() || !input.externalVersion.trim() || !input.title.trim()) {
    throw new Error("Inbox 후보에는 외부 키, 버전, 제목이 필요합니다.");
  }
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const now = input.discoveredAt ?? new Date().toISOString();
  await database.execute(
    `INSERT INTO inbox_candidates(
      id, source, external_key, external_version, title, goal, external_url,
      metadata_json, status, discovered_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new',$9,$9)
    ON CONFLICT(source, external_key) DO UPDATE SET
      external_version = excluded.external_version,
      title = excluded.title, goal = excluded.goal, external_url = excluded.external_url,
      metadata_json = excluded.metadata_json,
      status = CASE
        WHEN inbox_candidates.status = 'ignored'
          AND inbox_candidates.ignored_version <> excluded.external_version THEN 'new'
        ELSE inbox_candidates.status END,
      ignored_version = CASE
        WHEN inbox_candidates.ignored_version <> excluded.external_version THEN NULL
        ELSE inbox_candidates.ignored_version END,
      updated_at = excluded.updated_at`,
    [id, input.source, input.externalKey.trim(), input.externalVersion.trim(), input.title.trim(),
      input.goal?.trim() || null, input.externalUrl?.trim() || null,
      JSON.stringify(boundedMetadata(input.metadata)), now],
  );
  const [row] = await database.select<Array<{ id: string }>>(
    "SELECT id FROM inbox_candidates WHERE source = $1 AND external_key = $2",
    [input.source, input.externalKey.trim()],
  );
  return row.id;
}

export async function listInboxCandidates(
  status: InboxCandidate["status"] | "all" = "new",
  limit = 100,
): Promise<InboxCandidate[]> {
  const database = await getDatabase();
  return (await queryInboxCandidatesPage(database, status, { limit })).items;
}

export async function queryInboxCandidatesPage(
  database: InboxReadDatabase,
  status: InboxCandidate["status"] | "all" = "new",
  options: { limit?: number; offset?: number } = {},
): Promise<InboxCandidatePage> {
  const { limit, offset } = normalizedPage(options.limit, options.offset);
  const where = status === "all" ? "" : "WHERE status = $1";
  const countValues = status === "all" ? [] : [status];
  const rowValues = [...countValues, limit, offset];
  const limitIndex = countValues.length + 1;
  const [countRows, rows] = await Promise.all([
    database.select<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM inbox_candidates ${where}`,
      countValues,
    ),
    database.select<InboxCandidateRow[]>(
      `SELECT ${fields} FROM inbox_candidates
       ${where}
       ORDER BY updated_at DESC, id DESC
       LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
      rowValues,
    ),
  ]);
  return {
    items: rows.map(mapRow),
    total: Number(countRows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function listInboxCandidatePage(
  status: InboxCandidate["status"] | "all" = "new",
  options: { limit?: number; offset?: number } = {},
): Promise<InboxCandidatePage> {
  return queryInboxCandidatesPage(await getDatabase(), status, options);
}

async function getCandidate(id: string): Promise<InboxCandidate> {
  const database = await getDatabase();
  const [row] = await database.select<InboxCandidateRow[]>(
    `SELECT ${fields} FROM inbox_candidates WHERE id = $1`, [id],
  );
  if (!row) throw new Error("Inbox 후보를 찾을 수 없습니다.");
  return mapRow(row);
}

export async function linkInboxCandidate(id: string, workItemId: string): Promise<void> {
  const database = await getDatabase();
  const candidate = await getCandidate(id);
  const now = new Date().toISOString();
  await database.execute(
    `UPDATE inbox_candidates SET status = 'linked', linked_work_item_id = $1, updated_at = $2
     WHERE id = $3`,
    [workItemId, now, id],
  );
  if ((candidate.source === "jira" || candidate.source === "slack") && candidate.externalUrl) {
    await database.execute(
      `INSERT INTO work_item_links(
        id, work_item_id, kind, external_id, external_url, label, status, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'linked',$7)
      ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), workItemId, candidate.source, candidate.externalKey,
        candidate.externalUrl, candidate.title, now],
    );
  }
}

export async function adoptInboxCandidate(
  id: string,
  draft: InboxTaskDraft,
): Promise<string> {
  const candidate = await getCandidate(id);
  if (candidate.linkedWorkItemId) return candidate.linkedWorkItemId;
  const database = await getDatabase();
  if (candidate.externalUrl && (candidate.source === "jira" || candidate.source === "slack")) {
    const [existing] = await database.select<Array<{ work_item_id: string }>>(
      "SELECT work_item_id FROM work_item_links WHERE kind = $1 AND external_url = $2 LIMIT 1",
      [candidate.source, candidate.externalUrl],
    );
    if (existing) {
      await linkInboxCandidate(id, existing.work_item_id);
      return existing.work_item_id;
    }
  }
  const workItemId = await createWorkItem({
    title: draft.title || candidate.title,
    status: draft.status ?? "todo",
    priority: draft.priority,
    goal: draft.goal ?? candidate.goal ?? undefined,
    nextAction: draft.nextAction,
    doneDefinition: draft.doneDefinition,
    targetAt: draft.targetAt,
  });
  await linkInboxCandidate(id, workItemId);
  await database.execute(
    "UPDATE inbox_candidates SET status = 'adopted' WHERE id = $1",
    [id],
  );
  return workItemId;
}

export async function ignoreInboxCandidate(id: string): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.execute(
    `UPDATE inbox_candidates SET status = 'ignored', ignored_version = external_version,
      linked_work_item_id = NULL, updated_at = $1 WHERE id = $2`,
    [now, id],
  );
}

export async function discoverJiraInboxCandidates(): Promise<number> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE inbox_candidates SET status = 'linked', linked_work_item_id = (
       SELECT l.work_item_id FROM work_item_links l
       WHERE l.kind = 'jira' AND l.external_id = inbox_candidates.external_key LIMIT 1
     ), updated_at = $1
     WHERE source = 'jira' AND EXISTS (
       SELECT 1 FROM work_item_links l
       WHERE l.kind = 'jira' AND l.external_id = inbox_candidates.external_key
     )`,
    [new Date().toISOString()],
  );
  const rows = await database.select<Array<{
    issue_key: string; summary: string; status: string; status_category: string;
    project_key: string; updated_at: string; url: string; discovered_at: string;
  }>>(
    `SELECT j.issue_key, j.summary, j.status, j.status_category, j.project_key,
      j.updated_at, j.url, j.discovered_at
     FROM jira_issues j
     WHERE lower(j.status_category) <> 'done'
       AND NOT EXISTS (
         SELECT 1 FROM work_item_links l
         WHERE l.kind = 'jira' AND l.external_id = j.issue_key
       )
     ORDER BY j.updated_at DESC`,
  );
  for (const issue of rows) {
    await upsertInboxCandidate({
      source: "jira",
      externalKey: issue.issue_key,
      externalVersion: `${issue.updated_at}:${issue.status}`,
      title: `${issue.issue_key} · ${issue.summary}`,
      goal: `${issue.project_key} · ${issue.status}`,
      externalUrl: issue.url,
      metadata: { projectKey: issue.project_key, status: issue.status },
      discoveredAt: issue.discovered_at,
    });
  }
  return rows.length;
}

export async function discoverUnlinkedAiSessionCandidates(): Promise<number> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE inbox_candidates SET status = 'linked', linked_work_item_id = (
       SELECT a.linked_work_item_id FROM ai_sessions a
       WHERE (a.provider || ':' || a.session_id) = inbox_candidates.external_key LIMIT 1
     ), updated_at = $1
     WHERE source = 'ai' AND EXISTS (
       SELECT 1 FROM ai_sessions a
       WHERE (a.provider || ':' || a.session_id) = inbox_candidates.external_key
         AND a.linked_work_item_id IS NOT NULL
     )`,
    [new Date().toISOString()],
  );
  const rows = await database.select<Array<{
    provider: "claude" | "codex"; session_id: string; title: string;
    custom_title: string | null; cwd: string | null; model: string | null;
    modified_at_ms: number; discovered_at: string;
  }>>(
    `SELECT provider, session_id, title, custom_title, cwd, model,
      modified_at_ms, discovered_at
     FROM ai_sessions WHERE linked_work_item_id IS NULL
     ORDER BY modified_at_ms DESC LIMIT 300`,
  );
  for (const session of rows) {
    await upsertInboxCandidate({
      source: "ai",
      externalKey: `${session.provider}:${session.session_id}`,
      externalVersion: String(session.modified_at_ms),
      title: session.custom_title || session.title,
      goal: session.cwd ? `작업 경로: ${session.cwd}` : null,
      metadata: { provider: session.provider, model: session.model },
      discoveredAt: session.discovered_at,
    });
  }
  return rows.length;
}

export async function saveSlackMessageToInbox(messageId: string): Promise<string> {
  const database = await getDatabase();
  const [message] = await database.select<Array<{
    id: string; channel_name: string; user_name: string; text: string;
    permalink: string; message_ts: string; discovered_at: string;
  }>>(
    `SELECT id, channel_name, user_name, text, permalink, message_ts, discovered_at
     FROM slack_messages WHERE id = $1`,
    [messageId],
  );
  if (!message) throw new Error("저장할 Slack 메시지를 찾을 수 없습니다.");
  const titleText = message.text.replace(/\s+/g, " ").trim();
  const id = await upsertInboxCandidate({
    source: "slack",
    externalKey: message.permalink,
    externalVersion: message.message_ts,
    title: titleText.slice(0, 120) || `${message.channel_name}의 Slack 메시지`,
    goal: `${message.channel_name} · ${message.user_name}`,
    externalUrl: message.permalink,
    metadata: { channelName: message.channel_name, userName: message.user_name },
    discoveredAt: message.discovered_at,
  });
  const [existing] = await database.select<Array<{ work_item_id: string }>>(
    "SELECT work_item_id FROM work_item_links WHERE kind = 'slack' AND external_url = $1 LIMIT 1",
    [message.permalink],
  );
  if (existing) await linkInboxCandidate(id, existing.work_item_id);
  return id;
}

export async function discoverInboxCandidates(): Promise<{ jira: number; ai: number }> {
  const [jira, ai] = await Promise.all([
    discoverJiraInboxCandidates(),
    discoverUnlinkedAiSessionCandidates(),
  ]);
  return { jira, ai };
}
