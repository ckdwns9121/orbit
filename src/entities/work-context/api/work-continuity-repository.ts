import type { WorkItemStatus } from "../model/work-item";
import {
  TransitionConflictError,
  safeEventPayload,
  validateFocusTransition,
  validateTransitionInput,
  type ActivityEvent,
  type ActivityEventType,
  type FocusTransitionInput,
  type FocusTransitionResult,
  type StatusSuggestion,
  type TransitionWorkItemInput,
  type WorkItemContinuity,
} from "../model/work-continuity";
import { getDatabase } from "./database";

interface ContinuityRow {
  id: string;
  status: WorkItemStatus;
  checkpoint: string | null;
  next_action: string | null;
  blocked_reason: string | null;
  resume_condition: string | null;
  paused_at: string | null;
  last_focused_at: string | null;
  next_review_at: string | null;
  revision: number;
  updated_at: string;
}

interface ActivityEventRow {
  id: string;
  work_item_id: string | null;
  event_type: ActivityEventType;
  correlation_id: string;
  source: string;
  payload_json: string;
  occurred_at: string;
}

interface StatusSuggestionRow {
  id: string;
  work_item_id: string;
  source: string;
  proposed_status: WorkItemStatus;
  base_status: WorkItemStatus;
  base_work_item_revision: number;
  reason: string;
  observed_at: string;
  state: StatusSuggestion["state"];
  resolved_at: string | null;
  created_at: string;
}

const continuityFields = `
  id, status, checkpoint, next_action, blocked_reason, resume_condition,
  paused_at, last_focused_at, next_review_at, revision, updated_at
`;

function mapContinuity(row: ContinuityRow): WorkItemContinuity {
  return {
    id: row.id,
    status: row.status,
    checkpoint: row.checkpoint,
    nextAction: row.next_action,
    blockedReason: row.blocked_reason,
    resumeCondition: row.resume_condition,
    pausedAt: row.paused_at,
    lastFocusedAt: row.last_focused_at,
    nextReviewAt: row.next_review_at,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapSuggestion(row: StatusSuggestionRow): StatusSuggestion {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    source: row.source,
    proposedStatus: row.proposed_status,
    baseStatus: row.base_status,
    baseWorkItemRevision: row.base_work_item_revision,
    reason: row.reason,
    observedAt: row.observed_at,
    state: row.state,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export async function getWorkItemContinuity(id: string): Promise<WorkItemContinuity | null> {
  const database = await getDatabase();
  const rows = await database.select<ContinuityRow[]>(
    `SELECT ${continuityFields} FROM work_items WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapContinuity(rows[0]) : null;
}

export async function transitionWorkItem(input: TransitionWorkItemInput): Promise<WorkItemContinuity> {
  validateTransitionInput(input);
  const database = await getDatabase();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const result = await database.execute(
    `UPDATE work_items
     SET status = $1,
         checkpoint = COALESCE($2, checkpoint),
         next_action = COALESCE($3, next_action),
         blocked_reason = CASE WHEN $1 = 'blocked' THEN $4 ELSE NULL END,
         resume_condition = CASE WHEN $1 = 'blocked' THEN $5 ELSE NULL END,
         next_review_at = CASE WHEN $1 = 'blocked' THEN $6 ELSE NULL END,
         paused_at = CASE WHEN status = 'focus' AND $1 <> 'focus' THEN $7 ELSE paused_at END,
         completed_at = CASE WHEN $1 <> 'done' THEN NULL ELSE completed_at END,
         transition_correlation_id = $8,
         revision = revision + 1,
         updated_at = $7
     WHERE id = $9 AND revision = $10`,
    [
      input.targetStatus,
      input.checkpoint?.trim() || null,
      input.nextAction?.trim() || null,
      input.blockedReason?.trim() || null,
      input.resumeCondition?.trim() || null,
      input.nextReviewAt ?? null,
      occurredAt,
      correlationId,
      input.workItemId,
      input.expectedRevision,
    ],
  );
  if (result.rowsAffected !== 1) throw new TransitionConflictError();
  const current = await getWorkItemContinuity(input.workItemId);
  if (!current) throw new Error("전환된 작업을 다시 읽지 못했습니다.");
  return current;
}

export async function updateWorkItemCheckpoint(input: {
  workItemId: string;
  expectedRevision: number;
  checkpoint: string | null;
  nextAction: string | null;
  correlationId?: string;
  occurredAt?: string;
}): Promise<WorkItemContinuity> {
  const database = await getDatabase();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const result = await database.execute(
    `UPDATE work_items SET checkpoint = $1, next_action = $2,
      transition_correlation_id = $3, revision = revision + 1, updated_at = $4
     WHERE id = $5 AND revision = $6`,
    [input.checkpoint?.trim() || null, input.nextAction?.trim() || null,
      input.correlationId ?? crypto.randomUUID(), occurredAt,
      input.workItemId, input.expectedRevision],
  );
  if (result.rowsAffected !== 1) throw new TransitionConflictError();
  const current = await getWorkItemContinuity(input.workItemId);
  if (!current) throw new Error("수정된 작업을 다시 읽지 못했습니다.");
  return current;
}

export async function switchFocusedWorkItem(input: FocusTransitionInput): Promise<FocusTransitionResult> {
  validateFocusTransition(input);
  const database = await getDatabase();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const replay = await database.select<Array<{ status: string }>>(
    "SELECT status FROM work_focus_transition_commands WHERE correlation_id = $1",
    [correlationId],
  );
  if (replay.length === 0) {
    try {
      await database.execute(
        `INSERT INTO work_focus_transition_commands(
          id, correlation_id, current_work_item_id, requested_work_item_id,
          expected_slot_revision, expected_current_revision, expected_requested_revision,
          release_status, checkpoint, next_action, blocked_reason, resume_condition,
          next_review_at, status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)`,
        [
          crypto.randomUUID(), correlationId, input.currentWorkItemId, input.requestedWorkItemId,
          input.expectedSlotRevision, input.expectedCurrentRevision, input.expectedRequestedRevision,
          input.releaseStatus ?? null, input.checkpoint?.trim() || null,
          input.nextAction?.trim() || null, input.blockedReason?.trim() || null,
          input.resumeCondition?.trim() || null, input.nextReviewAt ?? null, occurredAt,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("revision_conflict") || message.includes("focus_slot_task_conflict")) {
        throw new TransitionConflictError();
      }
      throw error;
    }
  }
  const [slot] = await database.select<Array<{ revision: number; work_item_id: string | null }>>(
    "SELECT revision, work_item_id FROM work_focus_slot WHERE slot = 1",
  );
  return {
    correlationId,
    slotRevision: slot.revision,
    focusedWorkItemId: slot.work_item_id,
    current: input.currentWorkItemId ? await getWorkItemContinuity(input.currentWorkItemId) : null,
    requested: input.requestedWorkItemId ? await getWorkItemContinuity(input.requestedWorkItemId) : null,
  };
}

export async function getFocusSlot(): Promise<{ workItemId: string | null; revision: number }> {
  const database = await getDatabase();
  const [row] = await database.select<Array<{ work_item_id: string | null; revision: number }>>(
    "SELECT work_item_id, revision FROM work_focus_slot WHERE slot = 1",
  );
  return { workItemId: row.work_item_id, revision: row.revision };
}

export async function recordActivityEvent(input: {
  eventType: ActivityEventType;
  workItemId?: string | null;
  correlationId?: string;
  source?: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}): Promise<string> {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  await database.execute(
    `INSERT INTO activity_events(
      id, work_item_id, event_type, correlation_id, source, payload_json, occurred_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id, input.workItemId ?? null, input.eventType, input.correlationId ?? crypto.randomUUID(),
      input.source ?? "orbit", JSON.stringify(safeEventPayload(input.payload ?? {})),
      input.occurredAt ?? new Date().toISOString(),
    ],
  );
  return id;
}

export async function listActivityEvents(filters: {
  workItemId?: string;
  eventTypes?: ActivityEventType[];
  since?: string;
  limit?: number;
} = {}): Promise<ActivityEvent[]> {
  const database = await getDatabase();
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (filters.workItemId) {
    values.push(filters.workItemId);
    clauses.push(`work_item_id = $${values.length}`);
  }
  if (filters.since) {
    values.push(filters.since);
    clauses.push(`occurred_at >= $${values.length}`);
  }
  if (filters.eventTypes?.length) {
    const placeholders = filters.eventTypes.map((type) => {
      values.push(type);
      return `$${values.length}`;
    });
    clauses.push(`event_type IN (${placeholders.join(",")})`);
  }
  values.push(Math.min(Math.max(filters.limit ?? 100, 1), 500));
  const rows = await database.select<ActivityEventRow[]>(
    `SELECT id, work_item_id, event_type, correlation_id, source, payload_json, occurred_at
     FROM activity_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY occurred_at DESC, id DESC LIMIT $${values.length}`,
    values,
  );
  return rows.map((row) => ({
    id: row.id,
    workItemId: row.work_item_id,
    eventType: row.event_type,
    correlationId: row.correlation_id,
    source: row.source,
    payload: parsePayload(row.payload_json),
    occurredAt: row.occurred_at,
  }));
}

export async function createStatusSuggestion(input: {
  workItemId: string;
  source: string;
  proposedStatus: WorkItemStatus;
  reason: string;
  observedAt?: string;
}): Promise<string> {
  if (!input.reason.trim()) throw new Error("제안 이유가 필요합니다.");
  const database = await getDatabase();
  const current = await getWorkItemContinuity(input.workItemId);
  if (!current) throw new Error("작업을 찾을 수 없습니다.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO status_suggestions(
      id, work_item_id, source, proposed_status, base_status, base_work_item_revision,
      reason, observed_at, state, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
    ON CONFLICT(work_item_id, source, proposed_status) WHERE state = 'pending'
    DO UPDATE SET base_status = excluded.base_status,
      base_work_item_revision = excluded.base_work_item_revision,
      reason = excluded.reason, observed_at = excluded.observed_at, created_at = excluded.created_at`,
    [id, input.workItemId, input.source, input.proposedStatus, current.status, current.revision,
      input.reason.trim(), input.observedAt ?? now, now],
  );
  return id;
}

export async function listPendingStatusSuggestions(workItemId?: string): Promise<StatusSuggestion[]> {
  const database = await getDatabase();
  const rows = await database.select<StatusSuggestionRow[]>(
    `SELECT id, work_item_id, source, proposed_status, base_status, base_work_item_revision,
      reason, observed_at, state, resolved_at, created_at
     FROM status_suggestions WHERE state = 'pending'
       ${workItemId ? "AND work_item_id = $1" : ""}
     ORDER BY created_at DESC`,
    workItemId ? [workItemId] : [],
  );
  return rows.map(mapSuggestion);
}

export async function applyStatusSuggestion(id: string): Promise<void> {
  const database = await getDatabase();
  const [suggestion] = await database.select<StatusSuggestionRow[]>(
    `SELECT id, work_item_id, source, proposed_status, base_status, base_work_item_revision,
      reason, observed_at, state, resolved_at, created_at
     FROM status_suggestions WHERE id = $1 AND state = 'pending'`,
    [id],
  );
  if (!suggestion) throw new TransitionConflictError("제안이 이미 처리되었거나 만료되었습니다.");
  if (suggestion.proposed_status === "focus" || suggestion.proposed_status === "done") {
    throw new Error("집중 또는 완료 제안은 전용 확인 흐름에서 처리해야 합니다.");
  }
  await transitionWorkItem({
    workItemId: suggestion.work_item_id,
    expectedRevision: suggestion.base_work_item_revision,
    targetStatus: suggestion.proposed_status,
    correlationId: id,
  });
}

export async function ignoreStatusSuggestion(id: string): Promise<void> {
  const database = await getDatabase();
  const result = await database.execute(
    "UPDATE status_suggestions SET state = 'ignored', resolved_at = $1 WHERE id = $2 AND state = 'pending'",
    [new Date().toISOString(), id],
  );
  if (result.rowsAffected !== 1) throw new TransitionConflictError("제안이 이미 처리되었습니다.");
}
