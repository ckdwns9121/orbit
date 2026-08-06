import { describe, expect, test } from "bun:test";
import type { ExternalActionRequest } from "../data/external-action-repository";
import type { JiraTransitionPreview } from "./jira-transition-adapter";
import {
  externalActionErrorCategory,
  recoverJiraOutbox,
} from "./jira-outbox-recovery";
import { jiraPreviewToExternalActionInput } from "./jira-outbox-safety";

const preview: JiraTransitionPreview = {
  issueKey: "CGKR-2492",
  observedStatus: { id: "1", name: "In Progress", categoryKey: "indeterminate" },
  transition: { id: "41", name: "Complete", target: { id: "20", name: "Done", categoryKey: "done" } },
  availableTransitionsHash: "available-hash",
  previewHash: "preview-hash",
};

function action(id: string, status: ExternalActionRequest["status"], malformed = false): ExternalActionRequest {
  return {
    id,
    status,
    approvedAt: "2026-08-06T00:00:00.000Z",
    attemptCount: 1,
    errorCategory: null,
    errorSummary: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...jiraPreviewToExternalActionInput(preview, { workItemId: "task-1", idempotencyKey: `key-${id}` }),
    ...(malformed ? { observedState: "{" } : {}),
  };
}

describe("durable Jira outbox startup recovery", () => {
  test("reconciles only executing actions and exposes refreshed recoverable state", async () => {
    let actions = [
      action("remote-success", "executing"),
      action("unchanged", "executing"),
      action("malformed", "executing", true),
      action("approved", "approved"),
    ];
    let executeCalls = 0;
    const report = await recoverJiraOutbox({
      async listRecoverable() { return actions; },
      outbox: {
        async beginExternalActionExecution() { throw new Error("must not begin"); },
        async finishExternalAction(id, result) {
          actions = actions.map((item) => item.id === id
            ? { ...item, status: result.status, errorSummary: result.errorSummary ?? null }
            : item);
        },
      },
      jira: {
        async execute() { executeCalls += 1; throw new Error("must not POST"); },
        async reconcile() {
          const current = actions.find((item) => item.status === "executing");
          const succeeded = current?.id === "remote-success";
          return {
            issueKey: preview.issueKey,
            currentStatus: succeeded ? preview.transition.target : preview.observedStatus,
            outcome: succeeded ? "succeeded" : "retryable",
          };
        },
      },
      now: () => new Date("2026-08-07T00:00:00.000Z"),
    });

    expect(executeCalls).toBe(0);
    expect(report.examined).toBe(4);
    expect(report.reconciled).toBe(3);
    expect(report.failures).toEqual([]);
    expect(report.actions.find((item) => item.id === "remote-success")?.status).toBe("succeeded");
    expect(report.actions.find((item) => item.id === "unchanged")?.status).toBe("failed");
    expect(report.actions.find((item) => item.id === "malformed")?.status).toBe("failed");
    expect(report.actions.find((item) => item.id === "approved")?.status).toBe("approved");
  });

  test("maps structured Tauri categories to durable repository categories", () => {
    expect(externalActionErrorCategory("authentication")).toBe("auth");
    expect(externalActionErrorCategory("rate_limited")).toBe("rate-limit");
    expect(externalActionErrorCategory("network")).toBe("network");
    expect(externalActionErrorCategory("invalid_request")).toBe("validation");
  });
});
