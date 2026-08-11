import type { CreateWorkItemInput, WorkItemStatus } from "./work-item";

export const activityEventTypes = [
  "pause_requested", "pause_saved", "pause_cancelled", "task_blocked", "task_resumed",
  "context_opened", "checkpoint_updated", "next_action_updated", "evidence_linked",
  "blocked_resolved", "status_advanced", "task_completed", "stale_surfaced",
  "suggestion_created", "suggestion_applied", "suggestion_ignored", "inbox_adopted",
  "inbox_linked", "inbox_ignored", "external_action_changed", "task_deleted",
] as const;

export type ActivityEventType = (typeof activityEventTypes)[number];

export const qualifyingProgressEventTypes: ReadonlySet<ActivityEventType> = new Set([
  "checkpoint_updated",
  "next_action_updated",
  "evidence_linked",
  "blocked_resolved",
  "status_advanced",
  "task_completed",
]);

export interface WorkItemContinuity {
  id: string;
  status: WorkItemStatus;
  checkpoint: string | null;
  nextAction: string | null;
  blockedReason: string | null;
  resumeCondition: string | null;
  pausedAt: string | null;
  lastFocusedAt: string | null;
  nextReviewAt: string | null;
  revision: number;
  updatedAt: string;
}

export interface TransitionWorkItemInput {
  workItemId: string;
  expectedRevision: number;
  targetStatus: Exclude<WorkItemStatus, "focus" | "done">;
  checkpoint?: string | null;
  nextAction?: string | null;
  blockedReason?: string | null;
  resumeCondition?: string | null;
  nextReviewAt?: string | null;
  correlationId?: string;
  occurredAt?: string;
}

export interface FocusTransitionInput {
  currentWorkItemId: string | null;
  requestedWorkItemId: string | null;
  expectedSlotRevision: number;
  expectedCurrentRevision: number | null;
  expectedRequestedRevision: number | null;
  releaseStatus?: "todo" | "ai_running" | "review" | "blocked";
  checkpoint?: string | null;
  nextAction?: string | null;
  blockedReason?: string | null;
  resumeCondition?: string | null;
  nextReviewAt?: string | null;
  correlationId?: string;
  occurredAt?: string;
}

export interface FocusTransitionResult {
  correlationId: string;
  slotRevision: number;
  focusedWorkItemId: string | null;
  current: WorkItemContinuity | null;
  requested: WorkItemContinuity | null;
}

export interface ActivityEvent {
  id: string;
  workItemId: string | null;
  eventType: ActivityEventType;
  correlationId: string;
  source: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type SyncSource = "jira" | "github" | "slack" | "calendar" | "confluence" | "ai";
export type SyncStatus =
  | "never" | "syncing" | "fresh" | "stale" | "partial" | "failed"
  | "auth-required" | "rate-limited";

export interface SourceSyncState {
  source: SyncSource;
  scopeKey: string;
  status: SyncStatus;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  itemCount: number;
  errorCategory: string | null;
  errorSummary: string | null;
  retryAfterAt: string | null;
  updatedAt: string;
}

export interface StatusSuggestion {
  id: string;
  workItemId: string;
  source: string;
  proposedStatus: WorkItemStatus;
  baseStatus: WorkItemStatus;
  baseWorkItemRevision: number;
  reason: string;
  observedAt: string;
  state: "pending" | "applied" | "ignored" | "stale";
  resolvedAt: string | null;
  createdAt: string;
}

export interface InboxCandidateInput {
  source: "jira" | "slack" | "ai";
  externalKey: string;
  externalVersion: string;
  title: string;
  goal?: string | null;
  externalUrl?: string | null;
  metadata?: Record<string, unknown>;
  discoveredAt?: string;
}

export interface InboxCandidate extends Required<Omit<InboxCandidateInput, "metadata" | "goal" | "externalUrl" | "discoveredAt">> {
  id: string;
  goal: string | null;
  externalUrl: string | null;
  metadata: Record<string, unknown>;
  status: "new" | "adopted" | "linked" | "ignored" | "expired";
  linkedWorkItemId: string | null;
  ignoredVersion: string | null;
  discoveredAt: string;
  updatedAt: string;
}

export interface InboxTaskDraft extends Omit<CreateWorkItemInput, "status"> {
  status?: Exclude<WorkItemStatus, "focus" | "done">;
}

export class TransitionConflictError extends Error {
  constructor(message = "다른 화면에서 작업이 변경되었습니다. 최신 상태를 다시 불러와주세요.") {
    super(message);
    this.name = "TransitionConflictError";
  }
}

export function validateTransitionInput(input: TransitionWorkItemInput): void {
  if (input.targetStatus === "blocked") {
    if (!input.blockedReason?.trim() || !input.resumeCondition?.trim()) {
      throw new Error("막힘 상태에는 막힌 이유와 재개 조건이 필요합니다.");
    }
  }
}

export function validateFocusTransition(input: FocusTransitionInput): void {
  if (input.currentWorkItemId) {
    if (!input.releaseStatus || !input.checkpoint?.trim() || !input.nextAction?.trim()) {
      throw new Error("집중 작업을 전환하려면 체크포인트와 다음 행동이 필요합니다.");
    }
    if (input.releaseStatus === "blocked" && (!input.blockedReason?.trim() || !input.resumeCondition?.trim())) {
      throw new Error("막힘 상태에는 막힌 이유와 재개 조건이 필요합니다.");
    }
  }
  if (input.currentWorkItemId && input.currentWorkItemId === input.requestedWorkItemId) {
    throw new Error("이미 집중 중인 작업입니다.");
  }
}

export function safeEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    "fromStatus", "toStatus", "revision", "reasonCode", "sourceKind", "itemCount",
    "errorCategory", "actionKind", "candidateSource", "hasCheckpoint", "hasNextAction",
  ]);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.has(key)));
}
