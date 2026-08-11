import {
  finishExternalAction,
  listRecoverableExternalActions,
  type ExternalActionErrorCategory,
  type ExternalActionRequest,
} from "../../../../entities/work-context/api/external-action-repository";
import {
  executeApprovedJiraTransition,
  reconcileJiraTransition,
} from "../../jira-transition";
import {
  reconcileInterruptedJiraOutboxAction,
  type JiraOutboxPort,
  type JiraWritePort,
} from "../../jira-outbox-safety";

export interface JiraOutboxRecoveryReport {
  startedAt: string;
  completedAt: string;
  examined: number;
  reconciled: number;
  failures: Array<{ actionId: string; message: string }>;
  actions: ExternalActionRequest[];
}

export interface JiraOutboxRecoveryDependencies {
  listRecoverable(): Promise<ExternalActionRequest[]>;
  outbox: JiraOutboxPort;
  jira: JiraWritePort;
  now?: () => Date;
}

export function externalActionErrorCategory(value: string): ExternalActionErrorCategory {
  if (value === "authentication" || value === "authorization") return "auth";
  if (value === "rate_limited") return "rate-limit";
  if (value === "network") return "network";
  if (value === "unavailable" || value === "invalid_response") return "server";
  if (["invalid_request", "not_found", "stale_approval", "conflict", "remote_unchanged"].includes(value)) {
    return "validation";
  }
  return "unknown-outcome";
}

export async function recoverJiraOutbox(
  dependencies: JiraOutboxRecoveryDependencies,
): Promise<JiraOutboxRecoveryReport> {
  const startedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const before = await dependencies.listRecoverable();
  const executing = before.filter((action) => action.status === "executing");
  const failures: JiraOutboxRecoveryReport["failures"] = [];
  let reconciled = 0;

  for (const action of executing) {
    try {
      await reconcileInterruptedJiraOutboxAction(
        action,
        dependencies.outbox,
        dependencies.jira,
      );
      reconciled += 1;
    } catch (cause) {
      failures.push({
        actionId: action.id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  const actions = await dependencies.listRecoverable();
  return {
    startedAt,
    completedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    examined: before.length,
    reconciled,
    failures,
    actions,
  };
}

let activeRecovery: Promise<JiraOutboxRecoveryReport> | null = null;
let latestReport: JiraOutboxRecoveryReport | null = null;
const listeners = new Set<(report: JiraOutboxRecoveryReport) => void>();

export function getLatestJiraOutboxRecoveryReport() {
  return latestReport;
}

export function subscribeJiraOutboxRecovery(listener: (report: JiraOutboxRecoveryReport) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recoverDurableJiraOutbox(): Promise<JiraOutboxRecoveryReport> {
  activeRecovery ??= recoverJiraOutbox({
    listRecoverable: listRecoverableExternalActions,
    outbox: {
      async beginExternalActionExecution() {
        throw new Error("재시작 복구는 새 Jira 실행을 시작하지 않습니다.");
      },
      finishExternalAction: (id, result) => finishExternalAction(id, {
        ...result,
        errorCategory: result.errorCategory ? externalActionErrorCategory(result.errorCategory) : undefined,
      }),
    },
    jira: {
      execute: executeApprovedJiraTransition,
      reconcile: reconcileJiraTransition,
    },
  }).then((report) => {
    latestReport = report;
    listeners.forEach((listener) => listener(report));
    return report;
  }).finally(() => {
    activeRecovery = null;
  });
  return activeRecovery;
}
