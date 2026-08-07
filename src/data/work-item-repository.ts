import type {
  CreateWorkItemInput,
  WorkItem,
  WorkItemPriority,
  WorkItemSource,
  WorkItemStatus,
} from "../domain/work-item";
import { getDatabase } from "./database";
import type { TaskAiFixSuggestion } from "../domain/task-ai-fix";
import { getWorkItemContinuity, updateWorkItemCheckpoint } from "./work-continuity-repository";

interface WorkItemRow {
  id: string;
  title: string;
  status: WorkItemStatus;
  priority: WorkItemPriority | null;
  source: WorkItemSource;
  external_id: string | null;
  external_url: string | null;
  goal: string | null;
  checkpoint: string | null;
  next_action: string | null;
  done_definition: string | null;
  blocked_reason: string | null;
  resume_condition: string | null;
  paused_at: string | null;
  last_focused_at: string | null;
  next_review_at: string | null;
  revision: number;
  target_at: string | null;
  reminder_sent_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const selectFields = `
  id, title, status, priority, source, external_id, external_url,
  goal, checkpoint, next_action, done_definition, blocked_reason, resume_condition,
  paused_at, last_focused_at, next_review_at, revision, target_at, reminder_sent_at, position,
  created_at, updated_at, completed_at
`;

function toWorkItem(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    source: row.source,
    externalId: row.external_id,
    externalUrl: row.external_url,
    goal: row.goal,
    checkpoint: row.checkpoint,
    nextAction: row.next_action,
    doneDefinition: row.done_definition,
    blockedReason: row.blocked_reason,
    resumeCondition: row.resume_condition,
    pausedAt: row.paused_at,
    lastFocusedAt: row.last_focused_at,
    nextReviewAt: row.next_review_at,
    revision: row.revision,
    targetAt: row.target_at,
    reminderSentAt: row.reminder_sent_at,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function listWorkItems(): Promise<WorkItem[]> {
  const database = await getDatabase();
  const rows = await database.select<WorkItemRow[]>(`
    SELECT ${selectFields}
    FROM work_items
    ORDER BY
      CASE status
        WHEN 'focus' THEN 0
        WHEN 'review' THEN 1
        WHEN 'ai_running' THEN 2
        WHEN 'todo' THEN 3
        WHEN 'blocked' THEN 4
        WHEN 'inbox' THEN 5
        WHEN 'done' THEN 6
      END,
      position ASC,
      created_at DESC,
      id DESC
  `);

  return rows.map(toWorkItem);
}

export async function createWorkItem(input: CreateWorkItemInput): Promise<string> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  if (input.status === "focus" || input.status === "done") {
    throw new Error("새 작업은 만든 뒤 집중 또는 완료 흐름에서 상태를 변경해주세요.");
  }

  const [{ next_position }] = await database.select<Array<{ next_position: number }>>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM work_items WHERE status = $1",
    [input.status],
  );

  await database.execute(
    `INSERT INTO work_items (
      id, title, status, priority, source, goal, next_action, done_definition,
      target_at, position, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'orbit', $5, $6, $7, $8, $9, $10, $10)`,
    [
      id,
      input.title.trim(),
      input.status,
      input.priority ?? null,
      input.goal?.trim() || null,
      input.nextAction?.trim() || null,
      input.doneDefinition?.trim() || null,
      input.targetAt ?? null,
      next_position,
      now,
    ],
  );
  return id;
}

export async function reorderWorkItems(status: WorkItemStatus, orderedIds: string[]): Promise<void> {
  if (orderedIds.length < 2) return;
  const database = await getDatabase();
  const positionCases = orderedIds.map((_, index) => `WHEN $${index + 1} THEN ${index}`).join(" ");
  const idPlaceholders = orderedIds.map((_, index) => `$${index + 1}`).join(", ");
  await database.execute(
    `UPDATE work_items
     SET position = CASE id ${positionCases} ELSE position END
     WHERE status = $${orderedIds.length + 1} AND id IN (${idPlaceholders})`,
    [...orderedIds, status],
  );
}

export async function updateCheckpoint(
  id: string,
  checkpoint: string,
  nextAction: string,
): Promise<void> {
  const current = await getWorkItemContinuity(id);
  if (!current) throw new Error("작업을 찾을 수 없습니다.");
  await updateWorkItemCheckpoint({
    workItemId: id,
    expectedRevision: current.revision,
    checkpoint,
    nextAction,
  });
}

export async function updateWorkItemTitle(id: string, title: string): Promise<void> {
  const normalized = title.trim();
  if (!normalized) throw new Error("작업 이름은 비워둘 수 없습니다.");
  const database = await getDatabase();
  await database.execute(
    "UPDATE work_items SET title = $1, updated_at = $2 WHERE id = $3",
    [normalized, new Date().toISOString(), id],
  );
}

export async function updateWorkItemTargetAt(id: string, targetAt: string | null): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE work_items
     SET target_at = $1, reminder_sent_at = NULL, updated_at = $2
     WHERE id = $3`,
    [targetAt, new Date().toISOString(), id],
  );
}

export async function applyTaskAiFixes(suggestions: TaskAiFixSuggestion[]): Promise<void> {
  if (suggestions.length === 0) return;
  const database = await getDatabase();
  const now = new Date().toISOString();
  const values: Array<string> = [];
  const priorityCases: string[] = [];
  const targetCases: string[] = [];
  const idPlaceholders: string[] = [];
  for (const suggestion of suggestions) {
    const idIndex = values.push(suggestion.id);
    const priorityIndex = values.push(suggestion.priority);
    const targetIndex = values.push(suggestion.targetAt);
    priorityCases.push(`WHEN $${idIndex} THEN $${priorityIndex}`);
    targetCases.push(`WHEN $${idIndex} THEN $${targetIndex}`);
    idPlaceholders.push(`$${idIndex}`);
  }
  const updatedAtIndex = values.push(now);
  await database.execute(
    `UPDATE work_items
     SET priority = CASE id ${priorityCases.join(" ")} ELSE priority END,
         target_at = CASE id ${targetCases.join(" ")} ELSE target_at END,
         reminder_sent_at = NULL,
         updated_at = $${updatedAtIndex}
     WHERE status <> 'done' AND id IN (${idPlaceholders.join(", ")})`,
    values,
  );
}

export async function claimDueWorkItemReminders(now = new Date()): Promise<WorkItem[]> {
  const database = await getDatabase();
  const nowIso = now.toISOString();
  const rows = await database.select<WorkItemRow[]>(
    `SELECT ${selectFields}
     FROM work_items
     WHERE target_at IS NOT NULL
       AND target_at <= $1
       AND reminder_sent_at IS NULL
       AND status <> 'done'
     ORDER BY target_at ASC, created_at ASC`,
    [nowIso],
  );

  if (rows.length > 0) {
    const placeholders = rows.map((_, index) => `$${index + 2}`).join(", ");
    await database.execute(
      `UPDATE work_items SET reminder_sent_at = $1
       WHERE reminder_sent_at IS NULL AND id IN (${placeholders})`,
      [nowIso, ...rows.map(({ id }) => id)],
    );
  }
  return rows.map(toWorkItem);
}

export async function deleteWorkItem(id: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("DELETE FROM work_items WHERE id = $1", [id]);
}
