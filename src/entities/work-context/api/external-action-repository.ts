import { TransitionConflictError } from "../model/work-continuity";
import { getDatabase } from "./database";

export type ExternalActionStatus =
  | "draft" | "awaiting-approval" | "approved" | "executing" | "succeeded"
  | "failed" | "cancelled" | "needs-reconciliation";

export type ExternalActionErrorCategory =
  | "auth" | "rate-limit" | "network" | "server" | "validation" | "unknown-outcome";

export interface ExternalActionRequest {
  id: string;
  workItemId: string | null;
  provider: "jira";
  actionKind: "transition-status";
  externalKey: string;
  observedState: string;
  targetState: string;
  transitionId: string;
  transitionName: string;
  availableTransitionsHash: string;
  previewHash: string;
  idempotencyKey: string;
  status: ExternalActionStatus;
  approvedAt: string | null;
  attemptCount: number;
  errorCategory: ExternalActionErrorCategory | null;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ExternalActionRow {
  id: string;
  work_item_id: string | null;
  provider: "jira";
  action_kind: "transition-status";
  external_key: string;
  observed_state: string;
  target_state: string;
  transition_id: string;
  transition_name: string;
  available_transitions_hash: string;
  preview_hash: string;
  idempotency_key: string;
  status: ExternalActionStatus;
  approved_at: string | null;
  attempt_count: number;
  error_category: ExternalActionErrorCategory | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
}

const fields = `id, work_item_id, provider, action_kind, external_key, observed_state,
  target_state, transition_id, transition_name, available_transitions_hash, preview_hash,
  idempotency_key, status, approved_at, attempt_count, error_category, error_summary,
  created_at, updated_at`;

function mapRow(row: ExternalActionRow): ExternalActionRequest {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    provider: row.provider,
    actionKind: row.action_kind,
    externalKey: row.external_key,
    observedState: row.observed_state,
    targetState: row.target_state,
    transitionId: row.transition_id,
    transitionName: row.transition_name,
    availableTransitionsHash: row.available_transitions_hash,
    previewHash: row.preview_hash,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    approvedAt: row.approved_at,
    attemptCount: row.attempt_count,
    errorCategory: row.error_category,
    errorSummary: row.error_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createExternalActionRequest(input: Omit<ExternalActionRequest,
  "id" | "status" | "approvedAt" | "attemptCount" | "errorCategory" | "errorSummary" |
  "createdAt" | "updatedAt">): Promise<string> {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO external_action_requests(
      id, work_item_id, provider, action_kind, external_key, observed_state, target_state,
      transition_id, transition_name, available_transitions_hash, preview_hash,
      idempotency_key, status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$13)
    ON CONFLICT(idempotency_key) DO NOTHING`,
    [id, input.workItemId, input.provider, input.actionKind, input.externalKey,
      input.observedState, input.targetState, input.transitionId, input.transitionName,
      input.availableTransitionsHash, input.previewHash, input.idempotencyKey, now],
  );
  const [row] = await database.select<Array<{ id: string }>>(
    "SELECT id FROM external_action_requests WHERE idempotency_key = $1",
    [input.idempotencyKey],
  );
  return row.id;
}

export async function getExternalActionRequest(id: string): Promise<ExternalActionRequest | null> {
  const database = await getDatabase();
  const rows = await database.select<ExternalActionRow[]>(
    `SELECT ${fields} FROM external_action_requests WHERE id = $1`, [id],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listRecoverableExternalActions(): Promise<ExternalActionRequest[]> {
  const database = await getDatabase();
  const rows = await database.select<ExternalActionRow[]>(
    `SELECT ${fields} FROM external_action_requests
     WHERE status IN ('approved', 'executing', 'failed', 'needs-reconciliation')
     ORDER BY updated_at ASC`,
  );
  return rows.map(mapRow);
}

export async function listExternalActionRequests(
  statuses?: ExternalActionStatus[],
  limit = 100,
): Promise<ExternalActionRequest[]> {
  const database = await getDatabase();
  const values: Array<string | number> = [];
  let statusClause = "";
  if (statuses?.length) {
    const placeholders = statuses.map((status) => {
      values.push(status);
      return `$${values.length}`;
    });
    statusClause = `WHERE status IN (${placeholders.join(",")})`;
  }
  values.push(Math.min(Math.max(limit, 1), 500));
  const rows = await database.select<ExternalActionRow[]>(
    `SELECT ${fields} FROM external_action_requests ${statusClause}
     ORDER BY updated_at DESC, id DESC LIMIT $${values.length}`,
    values,
  );
  return rows.map(mapRow);
}

async function changeState(
  id: string,
  from: ExternalActionStatus[],
  to: ExternalActionStatus,
  additions = "",
  values: Array<string | number | null> = [],
): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const base = values.length;
  const fromPlaceholders = from.map((_, index) => `$${base + index + 3}`).join(",");
  const result = await database.execute(
    `UPDATE external_action_requests SET status = $1, updated_at = $2 ${additions}
     WHERE id = $${base + from.length + 3} AND status IN (${fromPlaceholders})`,
    [to, now, ...values, ...from, id],
  );
  if (result.rowsAffected !== 1) throw new TransitionConflictError("외부 작업 상태가 이미 변경되었습니다.");
}

export async function markExternalActionAwaitingApproval(id: string): Promise<void> {
  await changeState(id, ["draft"], "awaiting-approval");
}

export async function approveExternalAction(id: string, expectedPreviewHash: string): Promise<void> {
  const action = await getExternalActionRequest(id);
  if (!action || action.previewHash !== expectedPreviewHash) {
    throw new TransitionConflictError("미리보기가 변경되어 다시 확인해야 합니다.");
  }
  await changeState(id, ["awaiting-approval"], "approved", ", approved_at = $3", [new Date().toISOString()]);
}

export async function beginExternalActionExecution(id: string): Promise<ExternalActionRequest> {
  await changeState(id, ["approved"], "executing", ", attempt_count = attempt_count + 1");
  const action = await getExternalActionRequest(id);
  if (!action) throw new Error("외부 작업 요청을 찾을 수 없습니다.");
  return action;
}

export async function finishExternalAction(id: string, result: {
  status: "succeeded" | "failed" | "needs-reconciliation";
  errorCategory?: ExternalActionErrorCategory | null;
  errorSummary?: string | null;
}): Promise<void> {
  const summary = result.errorSummary?.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 240) ?? null;
  await changeState(
    id,
    ["executing"],
    result.status,
    ", error_category = $3, error_summary = $4",
    [result.errorCategory ?? null, summary],
  );
}

export async function prepareExternalActionRetry(id: string): Promise<void> {
  await changeState(
    id,
    ["failed", "needs-reconciliation"],
    "awaiting-approval",
    ", approved_at = NULL, error_category = NULL, error_summary = NULL",
  );
}

export async function cancelExternalAction(id: string): Promise<void> {
  await changeState(id, ["draft", "awaiting-approval", "approved", "failed"], "cancelled");
}
