import type {
  CreateWorkItemInput,
  WorkItem,
  WorkItemPriority,
  WorkItemSource,
  WorkItemStatus,
} from "../domain/work-item";
import { getDatabase } from "./database";

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
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const selectFields = `
  id, title, status, priority, source, external_id, external_url,
  goal, checkpoint, next_action, done_definition, position,
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
      updated_at DESC
  `);

  return rows.map(toWorkItem);
}

export async function createWorkItem(input: CreateWorkItemInput): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  if (input.status === "focus") {
    await database.execute(
      "UPDATE work_items SET status = 'todo', updated_at = $1 WHERE status = 'focus'",
      [now],
    );
  }

  const [{ next_position }] = await database.select<Array<{ next_position: number }>>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM work_items WHERE status = $1",
    [input.status],
  );

  await database.execute(
    `INSERT INTO work_items (
      id, title, status, priority, source, goal, next_action, done_definition,
      position, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'local', $5, $6, $7, $8, $9, $9)`,
    [
      id,
      input.title.trim(),
      input.status,
      input.priority ?? null,
      input.goal?.trim() || null,
      input.nextAction?.trim() || null,
      input.doneDefinition?.trim() || null,
      next_position,
      now,
    ],
  );
}

export async function moveWorkItem(id: string, status: WorkItemStatus): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const completedAt = status === "done" ? now : null;

  if (status === "focus") {
    await database.execute(
      `UPDATE work_items
       SET status = CASE WHEN id = $1 THEN 'focus' ELSE 'todo' END,
           completed_at = NULL,
           updated_at = $2
       WHERE id = $1 OR status = 'focus'`,
      [id, now],
    );
    return;
  }

  await database.execute(
    "UPDATE work_items SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4",
    [status, completedAt, now, id],
  );
}

export async function updateCheckpoint(
  id: string,
  checkpoint: string,
  nextAction: string,
): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE work_items
     SET checkpoint = $1, next_action = $2, updated_at = $3
     WHERE id = $4`,
    [checkpoint.trim() || null, nextAction.trim() || null, new Date().toISOString(), id],
  );
}
