import { expect, test } from "bun:test";
import {
  buildPreparedDraftPayload,
  exactExternalLinkAutomationIdentity,
  exactInboxIgnoreAutomationIdentity,
  executeReadOnlyRefresh,
  parseAutomationUndoPayload,
  planEligibleInboxAutomations,
} from "./automation";

const candidateSnapshot = {
  candidateId: "candidate-1",
  candidateVersion: "v1",
  priorStatus: "new" as const,
  priorLinkedWorkItemId: null,
  priorIgnoredVersion: null,
};

test("ignore undo payload requires a complete candidate snapshot", () => {
  expect(parseAutomationUndoPayload("exact-inbox-ignore", candidateSnapshot)).toEqual(candidateSnapshot);
  expect(() => parseAutomationUndoPayload("exact-inbox-ignore", {}))
    .toThrow("불완전");
  expect(() => parseAutomationUndoPayload("exact-inbox-ignore", null))
    .toThrow("없거나 손상");
});

test("external link undo payload validates the created link and prior AI state", () => {
  const payload = {
    ...candidateSnapshot,
    workItemId: "task-1",
    source: "jira",
    externalKey: "ORB-1",
    externalUrl: "https://example.atlassian.net/browse/ORB-1",
    label: "ORB-1",
    createdLinkId: "link-1",
    priorAiLinkedWorkItemId: null,
  };
  expect(parseAutomationUndoPayload("exact-external-link", payload)).toEqual(payload);
  expect(() => parseAutomationUndoPayload("exact-external-link", {
    ...candidateSnapshot,
    workItemId: "task-1",
  })).toThrow("외부 링크");
});

test("prepared drafts require actionable text and redact bearer credentials", () => {
  const draft = buildPreparedDraftPayload({
    workItemId: "task-1",
    checkpoint: " API 연결 완료 ",
    nextAction: " 통합 테스트 작성 ",
    evidence: [{ source: "jira", label: "Bearer hidden-token", url: "https://example.test" }],
  });
  expect(draft.checkpoint).toBe("API 연결 완료");
  expect(draft.nextAction).toBe("통합 테스트 작성");
  expect(draft.evidenceJson).not.toContain("hidden-token");
  expect(() => buildPreparedDraftPayload({
    workItemId: "task-1", checkpoint: "", nextAction: "테스트",
  })).toThrow("체크포인트");
});

test("read-only refresh records success only after the refresh completes", async () => {
  const calls: string[] = [];
  const result = await executeReadOnlyRefresh(
    async () => { calls.push("refresh"); },
    async () => { calls.push("record"); return "action-1"; },
  );
  expect(result).toBe("action-1");
  expect(calls).toEqual(["refresh", "record"]);

  calls.length = 0;
  await expect(executeReadOnlyRefresh(
    async () => { calls.push("refresh"); throw new Error("offline"); },
    async () => { calls.push("record"); return "action-2"; },
  )).rejects.toThrow("offline");
  expect(calls).toEqual(["refresh"]);
});

test("conflicting enabled link and ignore rules leave the candidate for review", () => {
  const candidate = {
    id: "candidate-1",
    source: "jira" as const,
    externalKey: "ORB-1",
    externalVersion: "v1",
    title: "Conflicting automation",
    goal: null,
    externalUrl: "https://example.atlassian.net/browse/ORB-1",
    metadata: {},
    status: "new" as const,
    linkedWorkItemId: null,
    ignoredVersion: null,
    discoveredAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  };
  const rules = [
    {
      id: "ignore-rule",
      ruleKind: "exact-inbox-ignore" as const,
      normalizedSourceIdentity: exactInboxIgnoreAutomationIdentity(candidate),
      status: "enabled" as const,
      minimumConfidence: 1,
    },
    {
      id: "link-rule",
      ruleKind: "exact-external-link" as const,
      normalizedSourceIdentity: exactExternalLinkAutomationIdentity({
        source: candidate.source,
        externalKey: candidate.externalKey,
        workItemId: "task-1",
      }),
      status: "enabled" as const,
      minimumConfidence: 1,
    },
  ];

  expect(planEligibleInboxAutomations(rules, [candidate])).toEqual([]);
});
