import { getDatabase } from "./database";
import {
  buildPreparedDraftPayload,
  executeReadOnlyRefresh,
  planEligibleInboxAutomations,
  parseAutomationUndoPayload,
  type ExactExternalLinkUndoPayload,
  type ExactInboxIgnoreUndoPayload,
  type ReversibleAutomationKind,
} from "../domain/automation";
import type { InboxCandidate } from "../domain/work-continuity";
import type { SyncSource } from "../domain/work-continuity";

export const automationRuleKinds = [
  "exact-external-link", "exact-inbox-ignore", "prepare-draft", "refresh-stale-read",
] as const;
export type AutomationRuleKind = (typeof automationRuleKinds)[number];
export type AutomationRuleStatus = "suggested" | "enabled" | "disabled";

export interface AutomationRule {
  id: string;
  ruleKind: AutomationRuleKind;
  normalizedSourceIdentity: string;
  status: AutomationRuleStatus;
  minimumConfidence: number;
  consecutiveApprovals: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationAction {
  id: string;
  ruleId: string | null;
  ruleKind: AutomationRuleKind;
  normalizedSourceIdentity: string;
  affectedRecordType: string;
  affectedRecordId: string;
  identityVersion: string;
  confidence: number;
  reason: string;
  state: "suggested" | "executed" | "undone" | "discarded";
  undoPayload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreparedCheckpointDraft {
  actionId: string;
  workItemId: string;
  checkpoint: string;
  nextAction: string;
  evidence: Array<{ source: string; label: string; url: string | null }>;
  createdAt: string;
}

interface AutomationRuleRow {
  id: string;
  rule_kind: AutomationRuleKind;
  normalized_source_identity: string;
  status: AutomationRuleStatus;
  minimum_confidence: number;
  consecutive_approvals: number;
  created_at: string;
  updated_at: string;
}

function mapRule(row: AutomationRuleRow): AutomationRule {
  return {
    id: row.id,
    ruleKind: row.rule_kind,
    normalizedSourceIdentity: row.normalized_source_identity,
    status: row.status,
    minimumConfidence: row.minimum_confidence,
    consecutiveApprovals: row.consecutive_approvals,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAutomationRules(): Promise<AutomationRule[]> {
  const database = await getDatabase();
  const rows = await database.select<AutomationRuleRow[]>(
    `SELECT id, rule_kind, normalized_source_identity, status, minimum_confidence,
      consecutive_approvals, created_at, updated_at
     FROM automation_rules ORDER BY updated_at DESC, id DESC`,
  );
  return rows.map(mapRule);
}

export async function listAutomationActions(limit = 100): Promise<AutomationAction[]> {
  const database = await getDatabase();
  const rows = await database.select<Array<{
    id: string; rule_id: string | null; rule_kind: AutomationRuleKind;
    normalized_source_identity: string; affected_record_type: string;
    affected_record_id: string; identity_version: string; confidence: number;
    reason: string; state: AutomationAction["state"]; undo_payload_json: string | null;
    created_at: string; updated_at: string;
  }>>(
    `SELECT id, rule_id, rule_kind, normalized_source_identity, affected_record_type,
      affected_record_id, identity_version, confidence, reason, state,
      undo_payload_json, created_at, updated_at
     FROM automation_actions ORDER BY created_at DESC, id DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows.map((row) => {
    let undoPayload: Record<string, unknown> | null = null;
    try { undoPayload = row.undo_payload_json ? JSON.parse(row.undo_payload_json) as Record<string, unknown> : null; }
    catch { undoPayload = null; }
    return {
      id: row.id, ruleId: row.rule_id, ruleKind: row.rule_kind,
      normalizedSourceIdentity: row.normalized_source_identity,
      affectedRecordType: row.affected_record_type, affectedRecordId: row.affected_record_id,
      identityVersion: row.identity_version, confidence: row.confidence,
      reason: row.reason, state: row.state, undoPayload,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  });
}

function normalizeIdentity(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().normalize("NFKC");
  if (!normalized) throw new Error("자동화 소스 식별자는 비워둘 수 없습니다.");
  return normalized;
}

async function enabledRuleFor(
  ruleKind: AutomationRuleKind,
  normalizedSourceIdentity: string,
): Promise<AutomationRule | null> {
  const identity = normalizeIdentity(normalizedSourceIdentity);
  const rules = await listAutomationRules();
  return rules.find((rule) => rule.ruleKind === ruleKind
    && rule.status === "enabled"
    && rule.normalizedSourceIdentity === identity) ?? null;
}

export function assertAllowedAutomationKind(kind: string): asserts kind is AutomationRuleKind {
  if (!(automationRuleKinds as readonly string[]).includes(kind)) {
    throw new Error("상태 변경, 외부 쓰기, 자동 완료·삭제, 퍼지 연결은 자동화할 수 없습니다.");
  }
}

export async function recordAutomationApproval(input: {
  ruleKind: AutomationRuleKind;
  normalizedSourceIdentity: string;
  approved: boolean;
  confidence: number;
  previousSourceIdentity?: string | null;
}): Promise<AutomationRule> {
  assertAllowedAutomationKind(input.ruleKind);
  const identity = normalizeIdentity(input.normalizedSourceIdentity);
  const confidence = Math.min(1, Math.max(0, input.confidence));
  const database = await getDatabase();
  const now = new Date().toISOString();
  if (input.previousSourceIdentity
    && normalizeIdentity(input.previousSourceIdentity) !== identity) {
    await database.execute(
      `UPDATE automation_rules SET consecutive_approvals = 0, status = 'suggested', updated_at = $1
       WHERE rule_kind = $2 AND normalized_source_identity = $3`,
      [now, input.ruleKind, normalizeIdentity(input.previousSourceIdentity)],
    );
  }
  const id = crypto.randomUUID();
  await database.execute(
    `INSERT INTO automation_rules(
      id, rule_kind, normalized_source_identity, status, minimum_confidence,
      consecutive_approvals, created_at, updated_at
    ) VALUES ($1,$2,$3,'suggested',$4,$5,$6,$6)
    ON CONFLICT(rule_kind, normalized_source_identity) DO UPDATE SET
      consecutive_approvals = CASE
        WHEN $7 = 1 AND $4 >= automation_rules.minimum_confidence
          THEN automation_rules.consecutive_approvals + 1
        ELSE 0 END,
      status = CASE WHEN automation_rules.status = 'enabled'
        AND ($7 = 0 OR $4 < automation_rules.minimum_confidence)
        THEN 'suggested' ELSE automation_rules.status END,
      updated_at = excluded.updated_at`,
    [id, input.ruleKind, identity, confidence,
      input.approved && confidence >= 1 ? 1 : 0, now, input.approved ? 1 : 0],
  );
  const [row] = await database.select<AutomationRuleRow[]>(
    `SELECT id, rule_kind, normalized_source_identity, status, minimum_confidence,
      consecutive_approvals, created_at, updated_at
     FROM automation_rules WHERE rule_kind = $1 AND normalized_source_identity = $2`,
    [input.ruleKind, identity],
  );
  return mapRule(row);
}

export async function enableAutomationRule(id: string): Promise<void> {
  const database = await getDatabase();
  const result = await database.execute(
    `UPDATE automation_rules SET status = 'enabled', updated_at = $1
     WHERE id = $2 AND consecutive_approvals >= 3`,
    [new Date().toISOString(), id],
  );
  if (result.rowsAffected !== 1) throw new Error("같은 작업을 3회 연속 승인한 뒤 자동화를 켤 수 있습니다.");
}

export async function disableAutomationRule(id: string): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    "UPDATE automation_rules SET status = 'disabled', updated_at = $1 WHERE id = $2",
    [new Date().toISOString(), id],
  );
}

async function enabledRule(input: {
  ruleId: string;
  ruleKind: AutomationRuleKind;
  normalizedSourceIdentity: string;
  confidence: number;
}): Promise<AutomationRuleRow> {
  assertAllowedAutomationKind(input.ruleKind);
  const database = await getDatabase();
  const [rule] = await database.select<AutomationRuleRow[]>(
    `SELECT id, rule_kind, normalized_source_identity, status, minimum_confidence,
      consecutive_approvals, created_at, updated_at FROM automation_rules WHERE id = $1`,
    [input.ruleId],
  );
  if (!rule || rule.status !== "enabled" || input.confidence < rule.minimum_confidence) {
    throw new Error("자동화 규칙이 꺼져 있거나 신뢰도가 변경되어 다시 승인이 필요합니다.");
  }
  if (normalizeIdentity(input.normalizedSourceIdentity) !== rule.normalized_source_identity) {
    throw new Error("소스 식별자가 변경되어 자동화 대신 제안으로 되돌아갑니다.");
  }
  if (rule.rule_kind !== input.ruleKind) throw new Error("자동화 규칙 종류가 일치하지 않습니다.");
  return rule;
}

async function insertAutomationAction(input: {
  rule: AutomationRuleRow;
  affectedRecordType: string;
  affectedRecordId: string;
  identityVersion: string;
  confidence: number;
  reason: string;
  payload?: object | null;
}): Promise<string> {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO automation_actions(
      id, rule_id, rule_kind, normalized_source_identity, affected_record_type,
      affected_record_id, identity_version, confidence, reason, state,
      undo_payload_json, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'executed',$10,$11,$11)
    ON CONFLICT(rule_kind, normalized_source_identity, affected_record_type,
      affected_record_id, identity_version) DO NOTHING`,
    [id, input.rule.id, input.rule.rule_kind, input.rule.normalized_source_identity,
      input.affectedRecordType, input.affectedRecordId, input.identityVersion,
      input.confidence, input.reason.trim().slice(0, 300),
      input.payload ? JSON.stringify(input.payload) : null, now],
  );
  const [row] = await database.select<Array<{ id: string }>>(
    `SELECT id FROM automation_actions WHERE rule_kind = $1
      AND normalized_source_identity = $2 AND affected_record_type = $3
      AND affected_record_id = $4 AND identity_version = $5`,
    [input.rule.rule_kind, input.rule.normalized_source_identity, input.affectedRecordType,
      input.affectedRecordId, input.identityVersion],
  );
  return row.id;
}

interface CandidateAutomationRow {
  id: string;
  source: InboxCandidate["source"];
  external_key: string;
  external_version: string;
  title: string;
  external_url: string | null;
  status: InboxCandidate["status"];
  linked_work_item_id: string | null;
  ignored_version: string | null;
}

async function candidateForAutomation(id: string): Promise<CandidateAutomationRow> {
  const database = await getDatabase();
  const [candidate] = await database.select<CandidateAutomationRow[]>(
    `SELECT id, source, external_key, external_version, title, external_url,
      status, linked_work_item_id, ignored_version
     FROM inbox_candidates WHERE id = $1`,
    [id],
  );
  if (!candidate) throw new Error("자동화할 Inbox 항목을 찾을 수 없습니다.");
  if (candidate.status !== "new") throw new Error("새 Inbox 항목만 자동 연결하거나 무시할 수 있습니다.");
  return candidate;
}

function candidateSnapshot(candidate: CandidateAutomationRow): ExactInboxIgnoreUndoPayload {
  return {
    candidateId: candidate.id,
    candidateVersion: candidate.external_version,
    priorStatus: candidate.status,
    priorLinkedWorkItemId: candidate.linked_work_item_id,
    priorIgnoredVersion: candidate.ignored_version,
  };
}

export async function executeExactExternalLinkAutomation(input: {
  ruleId: string;
  normalizedSourceIdentity: string;
  candidateId: string;
  workItemId: string;
  identityVersion: string;
  confidence: number;
  reason: string;
}): Promise<string> {
  const rule = await enabledRule({ ...input, ruleKind: "exact-external-link" });
  const database = await getDatabase();
  const candidate = await candidateForAutomation(input.candidateId);
  if (candidate.external_version !== input.identityVersion) {
    throw new Error("Inbox 항목 버전이 변경되어 자동 연결 대신 다시 확인해야 합니다.");
  }
  const [workItem] = await database.select<Array<{ id: string }>>(
    "SELECT id FROM work_items WHERE id = $1", [input.workItemId],
  );
  if (!workItem) throw new Error("연결할 Task를 찾을 수 없습니다.");
  if (!["jira", "slack", "ai"].includes(candidate.source)) {
    throw new Error("이 Inbox 소스는 정확 일치 자동 연결을 지원하지 않습니다.");
  }

  let createdLinkId: string | null = null;
  let priorAiLinkedWorkItemId: string | null = null;
  if (candidate.source === "jira" || candidate.source === "slack") {
    const [existing] = await database.select<Array<{ work_item_id: string }>>(
      `SELECT work_item_id FROM work_item_links
       WHERE kind = $1 AND (external_id = $2 OR ($3 IS NOT NULL AND external_url = $3))
       LIMIT 1`,
      [candidate.source, candidate.external_key, candidate.external_url],
    );
    if (existing && existing.work_item_id !== input.workItemId) {
      throw new Error("동일한 외부 항목이 다른 Task에 연결되어 자동 연결할 수 없습니다.");
    }
    if (!existing) createdLinkId = crypto.randomUUID();
  } else {
    const [session] = await database.select<Array<{ linked_work_item_id: string | null }>>(
      `SELECT linked_work_item_id FROM ai_sessions
       WHERE (provider || ':' || session_id) = $1`,
      [candidate.external_key],
    );
    if (!session) throw new Error("연결할 AI 세션을 찾을 수 없습니다.");
    priorAiLinkedWorkItemId = session.linked_work_item_id;
    if (priorAiLinkedWorkItemId && priorAiLinkedWorkItemId !== input.workItemId) {
      throw new Error("AI 세션이 이미 다른 Task에 연결되어 있습니다.");
    }
  }

  const payload: ExactExternalLinkUndoPayload = {
    ...candidateSnapshot(candidate),
    workItemId: input.workItemId,
    source: candidate.source as ExactExternalLinkUndoPayload["source"],
    externalKey: candidate.external_key,
    externalUrl: candidate.external_url,
    label: candidate.title.slice(0, 300),
    createdLinkId,
    priorAiLinkedWorkItemId,
  };
  return insertAutomationAction({
    rule, affectedRecordType: "inbox_candidate", affectedRecordId: candidate.id,
    identityVersion: input.identityVersion, confidence: input.confidence,
    reason: input.reason, payload,
  });
}

export async function executeExactInboxIgnoreAutomation(input: {
  ruleId: string;
  normalizedSourceIdentity: string;
  candidateId: string;
  identityVersion: string;
  confidence: number;
  reason: string;
}): Promise<string> {
  const rule = await enabledRule({ ...input, ruleKind: "exact-inbox-ignore" });
  const candidate = await candidateForAutomation(input.candidateId);
  if (candidate.external_version !== input.identityVersion) {
    throw new Error("Inbox 항목 버전이 변경되어 자동 무시 대신 다시 확인해야 합니다.");
  }
  return insertAutomationAction({
    rule, affectedRecordType: "inbox_candidate", affectedRecordId: candidate.id,
    identityVersion: input.identityVersion, confidence: input.confidence,
    reason: input.reason, payload: candidateSnapshot(candidate),
  });
}

export async function prepareCheckpointDraftAutomation(input: {
  ruleId: string;
  normalizedSourceIdentity: string;
  workItemId: string;
  expectedRevision: number;
  checkpoint: string;
  nextAction: string;
  evidence?: Array<{ source: string; label: string; url?: string | null }>;
  confidence: number;
  reason: string;
}): Promise<string> {
  const rule = await enabledRule({ ...input, ruleKind: "prepare-draft" });
  const payload = buildPreparedDraftPayload(input);
  return insertAutomationAction({
    rule, affectedRecordType: "work_item", affectedRecordId: input.workItemId,
    identityVersion: String(input.expectedRevision), confidence: input.confidence,
    reason: input.reason, payload,
  });
}

export async function executeStaleReadRefreshAutomation(input: {
  ruleId: string;
  normalizedSourceIdentity: string;
  source: SyncSource;
  scopeKey: string;
  identityVersion: string;
  confidence: number;
  reason: string;
  refresh: () => Promise<void>;
}): Promise<string> {
  const rule = await enabledRule({ ...input, ruleKind: "refresh-stale-read" });
  return executeReadOnlyRefresh(input.refresh, async () => {
    const currentRule = await enabledRule({ ...input, ruleKind: "refresh-stale-read" });
    if (currentRule.id !== rule.id) throw new Error("동기화 중 자동화 규칙이 변경되었습니다.");
    return insertAutomationAction({
      rule, affectedRecordType: "source_sync_scope",
      affectedRecordId: `${input.source}:${input.scopeKey}`,
      identityVersion: input.identityVersion, confidence: input.confidence,
      reason: input.reason,
    });
  });
}

export async function undoAutomationAction(id: string): Promise<Record<string, unknown>> {
  const database = await getDatabase();
  const [row] = await database.select<Array<{
    rule_kind: AutomationRuleKind;
    state: string;
    undo_payload_json: string | null;
  }>>(
    "SELECT rule_kind, state, undo_payload_json FROM automation_actions WHERE id = $1", [id],
  );
  if (!row || row.state !== "executed"
    || !["exact-external-link", "exact-inbox-ignore"].includes(row.rule_kind)) {
    throw new Error("이 자동화 동작은 실행 취소할 수 없습니다.");
  }
  let parsed: unknown;
  try { parsed = row.undo_payload_json ? JSON.parse(row.undo_payload_json) : null; }
  catch { throw new Error("자동화 실행 취소 정보가 손상되었습니다."); }
  const payload = parseAutomationUndoPayload(row.rule_kind as ReversibleAutomationKind, parsed);
  const result = await database.execute(
    "UPDATE automation_actions SET state = 'undone', updated_at = $1 WHERE id = $2 AND state = 'executed'",
    [new Date().toISOString(), id],
  );
  if (result.rowsAffected !== 1) throw new Error("자동화 실행 취소 상태가 변경되었습니다.");
  return payload as unknown as Record<string, unknown>;
}

export async function discardPreparedDraft(id: string): Promise<void> {
  const database = await getDatabase();
  const result = await database.execute(
    `UPDATE automation_actions SET state = 'discarded', updated_at = $1
     WHERE id = $2 AND rule_kind = 'prepare-draft' AND state = 'executed'`,
    [new Date().toISOString(), id],
  );
  if (result.rowsAffected !== 1) throw new Error("버릴 수 있는 체크포인트 초안을 찾을 수 없습니다.");
}

export async function listPreparedCheckpointDrafts(workItemId?: string): Promise<PreparedCheckpointDraft[]> {
  const database = await getDatabase();
  const rows = await database.select<Array<{
    action_id: string; work_item_id: string; checkpoint: string;
    next_action: string; evidence_json: string; created_at: string;
  }>>(
    `SELECT action_id, work_item_id, checkpoint, next_action, evidence_json, created_at
     FROM automation_prepared_drafts
     ${workItemId ? "WHERE work_item_id = $1" : ""}
     ORDER BY created_at DESC`,
    workItemId ? [workItemId] : [],
  );
  return rows.map((row) => {
    let evidence: PreparedCheckpointDraft["evidence"] = [];
    try {
      const parsed: unknown = JSON.parse(row.evidence_json);
      if (Array.isArray(parsed)) evidence = parsed as PreparedCheckpointDraft["evidence"];
    } catch { evidence = []; }
    return {
      actionId: row.action_id,
      workItemId: row.work_item_id,
      checkpoint: row.checkpoint,
      nextAction: row.next_action,
      evidence,
      createdAt: row.created_at,
    };
  });
}

export async function runEnabledInboxAutomations(
  candidates: InboxCandidate[],
): Promise<{ executed: number; errors: string[] }> {
  const plans = planEligibleInboxAutomations(await listAutomationRules(), candidates);
  const candidateTitles = new Map(candidates.map((candidate) => [candidate.id, candidate.title]));
  let executed = 0;
  const errors: string[] = [];

  for (const plan of plans) {
    try {
      if (plan.ruleKind === "exact-inbox-ignore") {
        await executeExactInboxIgnoreAutomation({
          ruleId: plan.ruleId,
          normalizedSourceIdentity: plan.normalizedSourceIdentity,
          candidateId: plan.candidateId,
          identityVersion: plan.identityVersion,
          confidence: plan.confidence,
          reason: "사용자가 반복 승인한 동일 외부 식별자의 Inbox 신호입니다.",
        });
      } else {
        if (!plan.workItemId) throw new Error("자동 연결 대상 Task가 필요합니다.");
        await executeExactExternalLinkAutomation({
          ruleId: plan.ruleId,
          normalizedSourceIdentity: plan.normalizedSourceIdentity,
          candidateId: plan.candidateId,
          workItemId: plan.workItemId,
          identityVersion: plan.identityVersion,
          confidence: plan.confidence,
          reason: "사용자가 반복 승인한 동일 외부 식별자와 Task의 정확한 연결입니다.",
        });
      }
      executed += 1;
    } catch (cause) {
      errors.push(`${candidateTitles.get(plan.candidateId) ?? plan.candidateId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return { executed, errors };
}

export async function prepareEnabledCheckpointDraft(input: {
  normalizedSourceIdentity: string;
  workItemId: string;
  expectedRevision: number;
  checkpoint: string;
  nextAction: string;
  evidence?: Array<{ source: string; label: string; url?: string | null }>;
}): Promise<string | null> {
  const rule = await enabledRuleFor("prepare-draft", input.normalizedSourceIdentity);
  if (!rule) return null;
  return prepareCheckpointDraftAutomation({
    ...input,
    ruleId: rule.id,
    confidence: 1,
    reason: "반복 승인된 근거 조합으로 체크포인트 초안을 미리 준비했습니다.",
  });
}

export async function refreshWithEnabledAutomation(input: {
  normalizedSourceIdentity: string;
  source: SyncSource;
  scopeKey: string;
  identityVersion: string;
  refresh: () => Promise<void>;
}): Promise<boolean> {
  const rule = await enabledRuleFor("refresh-stale-read", input.normalizedSourceIdentity);
  if (!rule) return false;
  await executeStaleReadRefreshAutomation({
    ...input,
    ruleId: rule.id,
    confidence: 1,
    reason: "사용자가 허용한 오래된 읽기 소스 범위를 갱신했습니다.",
  });
  return true;
}
