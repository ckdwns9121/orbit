import type { InboxCandidate } from "./work-continuity";

export const PREPARE_DRAFT_AUTOMATION_IDENTITY = "checkpoint:evidence-draft";

export interface AutomationRuleDescriptor {
  id: string;
  ruleKind: "exact-external-link" | "exact-inbox-ignore" | "prepare-draft" | "refresh-stale-read";
  normalizedSourceIdentity: string;
  status: "suggested" | "enabled" | "disabled";
  minimumConfidence: number;
}

export type InboxAutomationPlan = {
  ruleId: string;
  normalizedSourceIdentity: string;
  ruleKind: "exact-external-link" | "exact-inbox-ignore";
  candidateId: string;
  identityVersion: string;
  confidence: 1;
  workItemId?: string;
};

export type ReversibleAutomationKind = "exact-external-link" | "exact-inbox-ignore";

export interface AutomationCandidateSnapshot {
  candidateId: string;
  candidateVersion: string;
  priorStatus: InboxCandidate["status"];
  priorLinkedWorkItemId: string | null;
  priorIgnoredVersion: string | null;
}

export interface ExactExternalLinkUndoPayload extends AutomationCandidateSnapshot {
  workItemId: string;
  source: "jira" | "slack" | "ai";
  externalKey: string;
  externalUrl: string | null;
  label: string;
  createdLinkId: string | null;
  priorAiLinkedWorkItemId: string | null;
}

export type ExactInboxIgnoreUndoPayload = AutomationCandidateSnapshot;

export interface PreparedDraftPayload {
  workItemId: string;
  checkpoint: string;
  nextAction: string;
  evidenceJson: string;
}

const candidateStatuses = new Set<InboxCandidate["status"]>([
  "new", "adopted", "linked", "ignored", "expired",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function identityHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function identityText(value: string): string | null {
  if (!value || value.length % 2 !== 0 || /[^0-9a-f]/i.test(value)) return null;
  try {
    const bytes = new Uint8Array(value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function exactExternalLinkAutomationIdentity(input: {
  source: InboxCandidate["source"];
  externalKey: string;
  workItemId: string;
}): string {
  return `inbox-link:v1:${input.source}:${identityHex(input.externalKey)}:${identityHex(input.workItemId)}`;
}

export function exactInboxIgnoreAutomationIdentity(input: {
  source: InboxCandidate["source"];
  externalKey: string;
}): string {
  return `inbox-ignore:v1:${input.source}:${identityHex(input.externalKey)}`;
}

export function staleReadAutomationIdentity(source: string, scopeKey: string): string {
  return `${source.trim().toLocaleLowerCase()}:${scopeKey.trim().replace(/\s+/g, " ").toLocaleLowerCase()}`;
}

function parseLinkIdentity(identity: string): {
  source: InboxCandidate["source"];
  externalKey: string;
  workItemId: string;
} | null {
  const [prefix, version, source, externalKeyHex, workItemIdHex, ...extra] = identity.split(":");
  if (prefix !== "inbox-link" || version !== "v1" || extra.length
    || !["jira", "slack", "ai"].includes(source)) return null;
  const externalKey = identityText(externalKeyHex);
  const workItemId = identityText(workItemIdHex);
  return externalKey && workItemId
    ? { source: source as InboxCandidate["source"], externalKey, workItemId }
    : null;
}

export function planEligibleInboxAutomations(
  rules: AutomationRuleDescriptor[],
  candidates: InboxCandidate[],
): InboxAutomationPlan[] {
  const plans: InboxAutomationPlan[] = [];
  for (const candidate of candidates) {
    if (candidate.status !== "new") continue;
    const matching: InboxAutomationPlan[] = [];
    for (const rule of rules) {
      if (rule.status !== "enabled" || rule.minimumConfidence > 1) continue;
      if (rule.ruleKind === "exact-inbox-ignore"
        && rule.normalizedSourceIdentity === exactInboxIgnoreAutomationIdentity(candidate)) {
        matching.push({
          ruleId: rule.id,
          normalizedSourceIdentity: rule.normalizedSourceIdentity,
          ruleKind: rule.ruleKind,
          candidateId: candidate.id,
          identityVersion: candidate.externalVersion,
          confidence: 1,
        });
      }
      if (rule.ruleKind === "exact-external-link") {
        const parsed = parseLinkIdentity(rule.normalizedSourceIdentity);
        if (parsed?.source === candidate.source && parsed.externalKey === candidate.externalKey) {
          matching.push({
            ruleId: rule.id,
            normalizedSourceIdentity: rule.normalizedSourceIdentity,
            ruleKind: rule.ruleKind,
            candidateId: candidate.id,
            identityVersion: candidate.externalVersion,
            confidence: 1,
            workItemId: parsed.workItemId,
          });
        }
      }
    }
    // Two enabled rules for the same exact record are contradictory. Keep it visible for review.
    if (matching.length === 1) plans.push(matching[0]);
  }
  return plans;
}

export async function invokeInboxAutomationPlans(
  plans: InboxAutomationPlan[],
  execute: (plan: InboxAutomationPlan) => Promise<void>,
): Promise<Array<{ plan: InboxAutomationPlan; status: "executed" | "failed" }>> {
  const outcomes: Array<{ plan: InboxAutomationPlan; status: "executed" | "failed" }> = [];
  for (const plan of plans) {
    try {
      await execute(plan);
      outcomes.push({ plan, status: "executed" });
    } catch {
      outcomes.push({ plan, status: "failed" });
    }
  }
  return outcomes;
}

function candidateSnapshot(value: Record<string, unknown>): AutomationCandidateSnapshot | null {
  if (typeof value.candidateId !== "string" || !value.candidateId
    || typeof value.candidateVersion !== "string" || !value.candidateVersion
    || typeof value.priorStatus !== "string"
    || !candidateStatuses.has(value.priorStatus as InboxCandidate["status"])
    || !nullableString(value.priorLinkedWorkItemId)
    || !nullableString(value.priorIgnoredVersion)) return null;
  return {
    candidateId: value.candidateId,
    candidateVersion: value.candidateVersion,
    priorStatus: value.priorStatus as InboxCandidate["status"],
    priorLinkedWorkItemId: value.priorLinkedWorkItemId,
    priorIgnoredVersion: value.priorIgnoredVersion,
  };
}

export function parseAutomationUndoPayload(
  kind: ReversibleAutomationKind,
  value: unknown,
): ExactExternalLinkUndoPayload | ExactInboxIgnoreUndoPayload {
  if (!isObject(value)) throw new Error("자동화 실행 취소 정보가 없거나 손상되었습니다.");
  const snapshot = candidateSnapshot(value);
  if (!snapshot) throw new Error("자동화 실행 취소 정보가 불완전합니다.");
  if (kind === "exact-inbox-ignore") return snapshot;
  if (typeof value.workItemId !== "string" || !value.workItemId
    || !["jira", "slack", "ai"].includes(String(value.source))
    || typeof value.externalKey !== "string" || !value.externalKey
    || !nullableString(value.externalUrl)
    || typeof value.label !== "string" || !value.label
    || !nullableString(value.createdLinkId)
    || !nullableString(value.priorAiLinkedWorkItemId)) {
    throw new Error("외부 링크 실행 취소 정보가 불완전합니다.");
  }
  return {
    ...snapshot,
    workItemId: value.workItemId,
    source: value.source as ExactExternalLinkUndoPayload["source"],
    externalKey: value.externalKey,
    externalUrl: value.externalUrl,
    label: value.label,
    createdLinkId: value.createdLinkId,
    priorAiLinkedWorkItemId: value.priorAiLinkedWorkItemId,
  };
}

export function buildPreparedDraftPayload(input: {
  workItemId: string;
  checkpoint: string;
  nextAction: string;
  evidence?: Array<{ source: string; label: string; url?: string | null }>;
}): PreparedDraftPayload {
  const checkpoint = input.checkpoint.trim();
  const nextAction = input.nextAction.trim();
  if (!input.workItemId || !checkpoint || !nextAction) {
    throw new Error("초안에는 작업, 체크포인트, 다음 행동이 필요합니다.");
  }
  const evidence = (input.evidence ?? []).slice(0, 20).map((item) => ({
    source: item.source.slice(0, 40),
    label: item.label.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 240),
    url: item.url?.slice(0, 2_000) ?? null,
  }));
  return { workItemId: input.workItemId, checkpoint, nextAction, evidenceJson: JSON.stringify(evidence) };
}

export async function executeReadOnlyRefresh<T>(
  refresh: () => Promise<void>,
  recordSuccess: () => Promise<T>,
): Promise<T> {
  await refresh();
  return recordSuccess();
}
