import { describe, expect, test } from "bun:test";
import type { JiraTransitionPreview } from "../../../features/sources/jira-transition";
import {
  executeApprovedJiraOutboxAction,
  externalActionToJiraPreview,
  jiraPreviewToExternalActionInput,
  reconcileInterruptedJiraOutboxAction,
  type JiraExternalActionRecord,
} from "../../../features/sources/jira-outbox-safety";

const preview: JiraTransitionPreview = {
  issueKey: "CGKR-2492",
  observedStatus: { id: "1", name: "In Progress", categoryKey: "indeterminate" },
  transition: { id: "41", name: "Complete", target: { id: "20", name: "Done", categoryKey: "done" } },
  availableTransitionsHash: "available-hash",
  previewHash: "preview-hash",
};

function action(status: JiraExternalActionRecord["status"] = "approved"): JiraExternalActionRecord {
  return {
    id: "action-1",
    status,
    ...jiraPreviewToExternalActionInput(preview, { workItemId: "task-1", idempotencyKey: "idempotency-1" }),
  };
}

describe("Jira outbox safety", () => {
  test("round-trips exact status IDs/categories in stable JSON", () => {
    const input = jiraPreviewToExternalActionInput(preview, { workItemId: "task-1", idempotencyKey: "key-1" });
    expect(input.observedState).toBe('{"issueKey":"CGKR-2492","statusId":"1","statusName":"In Progress","statusCategoryKey":"indeterminate"}');
    expect(input.targetState).toBe('{"statusId":"20","statusName":"Done","statusCategoryKey":"done"}');
    expect(externalActionToJiraPreview({ id: "action-1", status: "approved", ...input })).toEqual(preview);
  });

  test("rejects a stored issue-key mismatch before any Jira call", () => {
    const record = { ...action(), externalKey: "OTHER-1" };
    expect(() => externalActionToJiraPreview(record)).toThrow("일치하지 않습니다");
  });

  test("executes the approved exact preview and marks success", async () => {
    const finishes: unknown[] = [];
    let approvedHash = "";
    const result = await executeApprovedJiraOutboxAction("action-1", {
      async beginExternalActionExecution() { return action(); },
      async finishExternalAction(_id, value) { finishes.push(value); },
    }, {
      async execute(approved) { approvedHash = approved.approvedPreviewHash; return { issueKey: preview.issueKey, transitionId: "41", targetStatus: preview.transition.target, outcome: "succeeded" }; },
      async reconcile() { throw new Error("not used"); },
    });
    expect(approvedHash).toBe("preview-hash");
    expect(result.status).toBe("succeeded");
    expect(finishes).toEqual([{ status: "succeeded" }]);
  });

  test("ambiguous network result enters reconciliation instead of blind retry", async () => {
    const finishes: unknown[] = [];
    const result = await executeApprovedJiraOutboxAction("action-1", {
      async beginExternalActionExecution() { return action(); },
      async finishExternalAction(_id, value) { finishes.push(value); },
    }, {
      async execute() { throw { category: "network", message: "connection reset", retryable: true }; },
      async reconcile() { throw new Error("not used"); },
    });
    expect(result.status).toBe("needs-reconciliation");
    expect(finishes).toEqual([{
      status: "needs-reconciliation",
      errorCategory: "network",
      errorSummary: "connection reset",
    }]);
  });

  test("stale approval fails without an automatic retry", async () => {
    let executeCalls = 0;
    const finishes: unknown[] = [];
    const result = await executeApprovedJiraOutboxAction("action-1", {
      async beginExternalActionExecution() { return action(); },
      async finishExternalAction(_id, value) { finishes.push(value); },
    }, {
      async execute() { executeCalls += 1; throw { category: "stale_approval", message: "changed", retryable: false }; },
      async reconcile() { throw new Error("not used"); },
    });
    expect(executeCalls).toBe(1);
    expect(result.status).toBe("failed");
    expect(finishes).toEqual([{ status: "failed", errorCategory: "stale_approval", errorSummary: "changed" }]);
  });

  test("malformed stored state is finalized as failed after begin and never calls Jira", async () => {
    let executeCalls = 0;
    const finishes: unknown[] = [];
    const malformed = { ...action(), observedState: "{not-json" };
    const result = await executeApprovedJiraOutboxAction("action-1", {
      async beginExternalActionExecution() { return { ...malformed, status: "executing" }; },
      async finishExternalAction(_id, value) { finishes.push(value); },
    }, {
      async execute() { executeCalls += 1; throw new Error("must not execute"); },
      async reconcile() { throw new Error("must not reconcile"); },
    });
    expect(executeCalls).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("invalid_request");
    expect(finishes).toEqual([{
      status: "failed",
      errorCategory: "invalid_request",
      errorSummary: "저장된 Jira 관측 상태를 읽지 못했습니다.",
    }]);
  });

  test("startup reconciliation converges remote success without a POST", async () => {
    let executeCalls = 0;
    const finishes: unknown[] = [];
    const result = await reconcileInterruptedJiraOutboxAction(action("executing"), {
      async beginExternalActionExecution() { throw new Error("not used"); },
      async finishExternalAction(_id, value) { finishes.push(value); },
    }, {
      async execute() { executeCalls += 1; throw new Error("must not POST"); },
      async reconcile() { return { issueKey: preview.issueKey, currentStatus: preview.transition.target, outcome: "succeeded" }; },
    });
    expect(executeCalls).toBe(0);
    expect(result.status).toBe("succeeded");
    expect(finishes).toEqual([{ status: "succeeded" }]);
  });

  test("unchanged remote state becomes failed/retryable but is not retried automatically", async () => {
    const finishes: unknown[] = [];
    const result = await reconcileInterruptedJiraOutboxAction(action("executing"), {
      async beginExternalActionExecution() { throw new Error("not used"); },
      async finishExternalAction(_id, value) { finishes.push(value); },
    }, {
      async execute() { throw new Error("must not POST"); },
      async reconcile() { return { issueKey: preview.issueKey, currentStatus: preview.observedStatus, outcome: "retryable" }; },
    });
    expect(result.status).toBe("failed");
    expect(finishes).toEqual([{
      status: "failed",
      errorCategory: "remote_unchanged",
      errorSummary: "Jira 상태가 변경되지 않아 사용자 승인 후 재시도할 수 있습니다.",
    }]);
  });

  test("startup reconciliation finalizes malformed executing rows as failed", async () => {
    let reconcileCalls = 0;
    const finishes: unknown[] = [];
    const result = await reconcileInterruptedJiraOutboxAction({
      ...action("executing"),
      targetState: "null",
    }, {
      async beginExternalActionExecution() { throw new Error("not used"); },
      async finishExternalAction(_id, value) { finishes.push(value); },
    }, {
      async execute() { throw new Error("must not POST"); },
      async reconcile() { reconcileCalls += 1; throw new Error("must not reconcile"); },
    });
    expect(reconcileCalls).toBe(0);
    expect(result.status).toBe("failed");
    expect(finishes[0]).toEqual({
      status: "failed",
      errorCategory: "invalid_request",
      errorSummary: "저장된 Jira 목표 상태를 읽지 못했습니다.",
    });
  });
});
