import {
  approveJiraTransitionPreview,
  jiraErrorRequiresReconciliation,
  normalizeJiraTransitionError,
  type JiraStatusSnapshot,
  type JiraTransitionError,
  type JiraTransitionExecution,
  type JiraTransitionPreview,
  type JiraTransitionReconciliation,
} from "../../jira-transition";

export interface JiraExternalActionInput {
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
}

export interface JiraExternalActionRecord extends JiraExternalActionInput {
  id: string;
  status: "draft" | "awaiting-approval" | "approved" | "executing" | "succeeded" | "failed" | "cancelled" | "needs-reconciliation";
}

export interface JiraOutboxPort {
  beginExternalActionExecution(id: string): Promise<JiraExternalActionRecord>;
  finishExternalAction(
    id: string,
    result: {
      status: "succeeded" | "failed" | "needs-reconciliation";
      errorCategory?: string;
      errorSummary?: string;
    },
  ): Promise<void>;
}

export interface JiraWritePort {
  execute(approved: ReturnType<typeof approveJiraTransitionPreview>): Promise<JiraTransitionExecution>;
  reconcile(preview: JiraTransitionPreview): Promise<JiraTransitionReconciliation>;
}

interface StoredObservedState {
  issueKey: string;
  statusId: string;
  statusName: string;
  statusCategoryKey: string;
}

interface StoredTargetState {
  statusId: string;
  statusName: string;
  statusCategoryKey: string;
}

function observedStateJson(issueKey: string, status: JiraStatusSnapshot) {
  return JSON.stringify({
    issueKey,
    statusId: status.id,
    statusName: status.name,
    statusCategoryKey: status.categoryKey,
  } satisfies StoredObservedState);
}

function targetStateJson(status: JiraStatusSnapshot) {
  return JSON.stringify({
    statusId: status.id,
    statusName: status.name,
    statusCategoryKey: status.categoryKey,
  } satisfies StoredTargetState);
}

function parseStoredState<T>(value: string, label: string): T {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as T;
  } catch {
    throw new Error(`저장된 Jira ${label} 상태를 읽지 못했습니다.`);
  }
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`저장된 Jira ${label} 값이 없습니다.`);
  return value;
}

export function jiraPreviewToExternalActionInput(
  preview: JiraTransitionPreview,
  options: { workItemId?: string | null; idempotencyKey: string },
): JiraExternalActionInput {
  if (!options.idempotencyKey.trim()) throw new Error("Jira 실행 idempotency key가 필요합니다.");
  return {
    workItemId: options.workItemId ?? null,
    provider: "jira",
    actionKind: "transition-status",
    externalKey: preview.issueKey,
    observedState: observedStateJson(preview.issueKey, preview.observedStatus),
    targetState: targetStateJson(preview.transition.target),
    transitionId: preview.transition.id,
    transitionName: preview.transition.name,
    availableTransitionsHash: preview.availableTransitionsHash,
    previewHash: preview.previewHash,
    idempotencyKey: options.idempotencyKey,
  };
}

export function externalActionToJiraPreview(action: JiraExternalActionRecord): JiraTransitionPreview {
  if (action.provider !== "jira" || action.actionKind !== "transition-status") {
    throw new Error("Jira 상태 전이 action이 아닙니다.");
  }
  const observed = parseStoredState<StoredObservedState>(action.observedState, "관측");
  const target = parseStoredState<StoredTargetState>(action.targetState, "목표");
  const issueKey = requiredString(observed.issueKey, "issue key").toLocaleUpperCase();
  if (issueKey !== action.externalKey.toLocaleUpperCase()) {
    throw new Error("저장된 Jira issue key가 action 대상과 일치하지 않습니다.");
  }
  return {
    issueKey,
    observedStatus: {
      id: requiredString(observed.statusId, "관측 status id"),
      name: requiredString(observed.statusName, "관측 status name"),
      categoryKey: requiredString(observed.statusCategoryKey, "관측 category"),
    },
    transition: {
      id: requiredString(action.transitionId, "transition id"),
      name: requiredString(action.transitionName, "transition name"),
      target: {
        id: requiredString(target.statusId, "목표 status id"),
        name: requiredString(target.statusName, "목표 status name"),
        categoryKey: requiredString(target.statusCategoryKey, "목표 category"),
      },
    },
    availableTransitionsHash: requiredString(action.availableTransitionsHash, "available transition hash"),
    previewHash: requiredString(action.previewHash, "preview hash"),
  };
}

export interface JiraActionRunResult {
  status: "succeeded" | "failed" | "needs-reconciliation";
  error?: JiraTransitionError;
}

function malformedStoredActionError(cause: unknown): JiraTransitionError {
  return {
    category: "invalid_request",
    message: cause instanceof Error ? cause.message : "저장된 Jira 작업 상태를 읽지 못했습니다.",
    retryable: false,
  };
}

export async function executeApprovedJiraOutboxAction(
  actionId: string,
  outbox: JiraOutboxPort,
  jira: JiraWritePort,
): Promise<JiraActionRunResult> {
  const action = await outbox.beginExternalActionExecution(actionId);
  let preview: JiraTransitionPreview;
  try {
    preview = externalActionToJiraPreview(action);
  } catch (cause) {
    const error = malformedStoredActionError(cause);
    await outbox.finishExternalAction(actionId, {
      status: "failed",
      errorCategory: error.category,
      errorSummary: error.message,
    });
    return { status: "failed", error };
  }
  try {
    await jira.execute(approveJiraTransitionPreview(preview));
    await outbox.finishExternalAction(actionId, { status: "succeeded" });
    return { status: "succeeded" };
  } catch (cause) {
    const error = normalizeJiraTransitionError(cause);
    const status = jiraErrorRequiresReconciliation(error) ? "needs-reconciliation" : "failed";
    await outbox.finishExternalAction(actionId, {
      status,
      errorCategory: error.category,
      errorSummary: error.message,
    });
    return { status, error };
  }
}

export async function reconcileInterruptedJiraOutboxAction(
  action: JiraExternalActionRecord,
  outbox: JiraOutboxPort,
  jira: JiraWritePort,
): Promise<JiraActionRunResult> {
  let preview: JiraTransitionPreview;
  try {
    preview = externalActionToJiraPreview(action);
  } catch (cause) {
    const error = malformedStoredActionError(cause);
    await outbox.finishExternalAction(action.id, {
      status: "failed",
      errorCategory: error.category,
      errorSummary: error.message,
    });
    return { status: "failed", error };
  }
  try {
    const reconciliation = await jira.reconcile(preview);
    const status = reconciliation.outcome === "succeeded"
      ? "succeeded"
      : reconciliation.outcome === "retryable"
        ? "failed"
        : "needs-reconciliation";
    await outbox.finishExternalAction(action.id, {
      status,
      ...(status === "failed" ? {
        errorCategory: "remote_unchanged",
        errorSummary: "Jira 상태가 변경되지 않아 사용자 승인 후 재시도할 수 있습니다.",
      } : {}),
      ...(status === "needs-reconciliation" ? {
        errorCategory: "remote_state_diverged",
        errorSummary: "Jira 상태가 예상 경로와 달라 사용자 확인이 필요합니다.",
      } : {}),
    });
    return { status };
  } catch (cause) {
    const error = normalizeJiraTransitionError(cause);
    await outbox.finishExternalAction(action.id, {
      status: "needs-reconciliation",
      errorCategory: error.category,
      errorSummary: error.message,
    });
    return { status: "needs-reconciliation", error };
  }
}
