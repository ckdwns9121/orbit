import { invoke } from "@tauri-apps/api/core";
import { getAppSettings } from "../data/settings-repository";

export interface JiraStatusSnapshot {
  id: string;
  name: string;
  categoryKey: string;
}

export interface JiraTransitionOption {
  id: string;
  name: string;
  target: JiraStatusSnapshot;
}

export interface JiraTransitionPreview {
  issueKey: string;
  observedStatus: JiraStatusSnapshot;
  transition: JiraTransitionOption;
  availableTransitionsHash: string;
  previewHash: string;
}

export interface ApprovedJiraTransition {
  preview: JiraTransitionPreview;
  approvedPreviewHash: string;
}

export type JiraErrorCategory =
  | "authentication"
  | "authorization"
  | "not_found"
  | "invalid_request"
  | "stale_approval"
  | "rate_limited"
  | "conflict"
  | "unavailable"
  | "network"
  | "invalid_response";

export interface JiraTransitionError {
  category: JiraErrorCategory;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface JiraTransitionExecution {
  issueKey: string;
  transitionId: string;
  targetStatus: JiraStatusSnapshot;
  outcome: "succeeded";
}

export interface JiraTransitionReconciliation {
  issueKey: string;
  currentStatus: JiraStatusSnapshot;
  outcome: "succeeded" | "retryable" | "needs_user_review";
}

async function jiraConnectionSettings() {
  const settings = await getAppSettings();
  if (!settings.jira_url || !settings.jira_email) {
    throw normalizeJiraTransitionError({
      category: "invalid_request",
      message: "Settings에서 Jira 사이트 URL과 계정 이메일을 설정해주세요.",
      retryable: false,
    });
  }
  return { jiraUrl: settings.jira_url, jiraEmail: settings.jira_email };
}

export function normalizeJiraTransitionError(cause: unknown): JiraTransitionError {
  if (cause && typeof cause === "object") {
    const candidate = cause as Partial<JiraTransitionError>;
    if (typeof candidate.category === "string" && typeof candidate.message === "string") {
      return {
        category: candidate.category as JiraErrorCategory,
        message: candidate.message,
        retryable: candidate.retryable === true,
        ...(typeof candidate.retryAfterSeconds === "number" ? { retryAfterSeconds: candidate.retryAfterSeconds } : {}),
      };
    }
  }
  return {
    category: "invalid_response",
    message: cause instanceof Error ? cause.message : String(cause ?? "Jira 요청에 실패했습니다."),
    retryable: true,
  };
}

async function invokeJira<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    throw normalizeJiraTransitionError(cause);
  }
}

export async function previewJiraDoneTransition(
  issueKey: string,
  preferredTransitionId?: string,
): Promise<JiraTransitionPreview> {
  const connection = await jiraConnectionSettings();
  return invokeJira<JiraTransitionPreview>("preview_jira_status_transition", {
    ...connection,
    issueKey,
    targetCategory: "done",
    preferredTransitionId: preferredTransitionId ?? null,
  });
}

export function approveJiraTransitionPreview(preview: JiraTransitionPreview): ApprovedJiraTransition {
  return { preview, approvedPreviewHash: preview.previewHash };
}

export async function executeApprovedJiraTransition(
  approved: ApprovedJiraTransition,
): Promise<JiraTransitionExecution> {
  const connection = await jiraConnectionSettings();
  return invokeJira<JiraTransitionExecution>("execute_approved_jira_status_transition", {
    ...connection,
    approved,
  });
}

export async function reconcileJiraTransition(
  preview: JiraTransitionPreview,
): Promise<JiraTransitionReconciliation> {
  const connection = await jiraConnectionSettings();
  return invokeJira<JiraTransitionReconciliation>("reconcile_jira_status_transition", {
    ...connection,
    preview,
  });
}

export function jiraErrorRequiresReconciliation(error: JiraTransitionError) {
  return error.category === "network" || error.category === "unavailable" || error.category === "invalid_response";
}
