import { invoke } from "@tauri-apps/api/core";
import type { AiSession, DiscoveredAiSession } from "../domain/ai-session";
import { getDatabase } from "./database";

interface AiSessionRow {
  provider: AiSession["provider"];
  session_id: string;
  title: string;
  custom_title: string | null;
  completion_state: AiSession["completionState"];
  cwd: string | null;
  model: string | null;
  first_prompt: string | null;
  last_prompt: string | null;
  created_at: string | null;
  updated_at: string | null;
  modified_at_ms: number;
  message_count: number;
  acknowledged_at_ms: number;
  linked_work_item_id: string | null;
}

function toSession(row: AiSessionRow): AiSession {
  return {
    provider: row.provider,
    sessionId: row.session_id,
    title: row.title,
    customTitle: row.custom_title,
    completionState: row.completion_state,
    cwd: row.cwd,
    model: row.model,
    firstPrompt: row.first_prompt,
    lastPrompt: row.last_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    modifiedAtMs: row.modified_at_ms,
    messageCount: row.message_count,
    acknowledgedAtMs: row.acknowledged_at_ms,
    linkedWorkItemId: row.linked_work_item_id,
  };
}

export async function syncLocalAiSessions(): Promise<AiSession[]> {
  const discovered = await invoke<DiscoveredAiSession[]>("scan_local_ai_sessions");
  const database = await getDatabase();
  const discoveredAt = new Date().toISOString();

  for (const session of discovered) {
    await database.execute(
      `INSERT INTO ai_sessions (
        provider, session_id, title, cwd, model, first_prompt, last_prompt,
        created_at, updated_at, modified_at_ms, message_count,
        acknowledged_at_ms, discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $12)
      ON CONFLICT(provider, session_id) DO UPDATE SET
        title = excluded.title,
        cwd = excluded.cwd,
        model = excluded.model,
        first_prompt = excluded.first_prompt,
        last_prompt = excluded.last_prompt,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        modified_at_ms = excluded.modified_at_ms,
        message_count = excluded.message_count,
        completion_state = CASE
          WHEN excluded.modified_at_ms > ai_sessions.modified_at_ms THEN 'active'
          ELSE ai_sessions.completion_state
        END,
        discovered_at = excluded.discovered_at`,
      [
        session.provider, session.sessionId, session.title, session.cwd, session.model,
        session.firstPrompt, session.lastPrompt, session.createdAt, session.updatedAt,
        session.modifiedAtMs, session.messageCount, discoveredAt,
      ],
    );
  }

  await database.execute(
    `UPDATE work_items
     SET status = 'ai_running', completed_at = NULL, updated_at = $1
     WHERE status = 'done' AND id IN (
       SELECT DISTINCT linked_work_item_id
       FROM ai_sessions
       WHERE linked_work_item_id IS NOT NULL AND completion_state = 'active'
     )`,
    [discoveredAt],
  );

  return listAiSessions();
}

export async function listAiSessions(): Promise<AiSession[]> {
  const database = await getDatabase();
  const rows = await database.select<AiSessionRow[]>(`
    SELECT provider, session_id, title, custom_title, completion_state, cwd, model, first_prompt, last_prompt,
      created_at, updated_at, modified_at_ms, message_count,
      acknowledged_at_ms, linked_work_item_id
    FROM ai_sessions
    ORDER BY modified_at_ms DESC
    LIMIT 300
  `);
  return rows.map(toSession);
}

export async function setAiSessionCompletion(
  provider: AiSession["provider"],
  sessionId: string,
  completionState: AiSession["completionState"],
): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    "UPDATE ai_sessions SET completion_state = $1 WHERE provider = $2 AND session_id = $3",
    [completionState, provider, sessionId],
  );
}

export interface WorkItemSessionProgress {
  workItemId: string;
  total: number;
  done: number;
}

export async function listWorkItemSessionProgress(): Promise<Record<string, WorkItemSessionProgress>> {
  const database = await getDatabase();
  const rows = await database.select<Array<{ work_item_id: string; total: number; done: number }>>(
    `SELECT linked_work_item_id AS work_item_id,
      COUNT(*) AS total,
      SUM(CASE WHEN completion_state = 'done' THEN 1 ELSE 0 END) AS done
     FROM ai_sessions
     WHERE linked_work_item_id IS NOT NULL
     GROUP BY linked_work_item_id`,
  );
  return Object.fromEntries(rows.map((row) => [row.work_item_id, {
    workItemId: row.work_item_id,
    total: row.total,
    done: row.done,
  }]));
}

export async function updateAiSessionTitle(
  provider: AiSession["provider"],
  sessionId: string,
  title: string,
): Promise<void> {
  const normalized = title.trim();
  if (!normalized) throw new Error("세션 이름은 비워둘 수 없습니다.");
  const database = await getDatabase();
  await database.execute(
    "UPDATE ai_sessions SET custom_title = $1 WHERE provider = $2 AND session_id = $3",
    [normalized, provider, sessionId],
  );
}

export async function acknowledgeAiSession(provider: AiSession["provider"], sessionId: string): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE ai_sessions SET acknowledged_at_ms = modified_at_ms
     WHERE provider = $1 AND session_id = $2`,
    [provider, sessionId],
  );
}

export async function linkAiSession(
  provider: AiSession["provider"],
  sessionId: string,
  workItemId: string | null,
): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE ai_sessions SET linked_work_item_id = $1, acknowledged_at_ms = modified_at_ms
     WHERE provider = $2 AND session_id = $3`,
    [workItemId, provider, sessionId],
  );
}
