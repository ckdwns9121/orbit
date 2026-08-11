import { describe, expect, test } from "bun:test";
import {
  approveJiraTransitionPreview,
  jiraErrorRequiresReconciliation,
  normalizeJiraTransitionError,
  type JiraTransitionPreview,
} from "../../../features/sources/jira-transition";

const preview: JiraTransitionPreview = {
  issueKey: "CGKR-2492",
  observedStatus: { id: "1", name: "In Progress", categoryKey: "indeterminate" },
  transition: { id: "41", name: "Complete", target: { id: "20", name: "Done", categoryKey: "done" } },
  availableTransitionsHash: "available-hash",
  previewHash: "preview-hash",
};

describe("Jira transition adapter safety", () => {
  test("approval binds the exact preview hash", () => {
    expect(approveJiraTransitionPreview(preview)).toEqual({
      preview,
      approvedPreviewHash: "preview-hash",
    });
  });

  test("preserves structured Rust error classification", () => {
    expect(normalizeJiraTransitionError({
      category: "stale_approval",
      message: "changed",
      retryable: false,
    })).toEqual({ category: "stale_approval", message: "changed", retryable: false });
  });

  test("only ambiguous remote outcomes require reconciliation", () => {
    expect(jiraErrorRequiresReconciliation({ category: "network", message: "timeout", retryable: true })).toBe(true);
    expect(jiraErrorRequiresReconciliation({ category: "unavailable", message: "503", retryable: true })).toBe(true);
    expect(jiraErrorRequiresReconciliation({ category: "authentication", message: "401", retryable: false })).toBe(false);
    expect(jiraErrorRequiresReconciliation({ category: "stale_approval", message: "changed", retryable: false })).toBe(false);
  });

  test("unknown failures become retryable invalid responses without leaking objects", () => {
    expect(normalizeJiraTransitionError(new Error("broken"))).toEqual({
      category: "invalid_response",
      message: "broken",
      retryable: true,
    });
  });
});
