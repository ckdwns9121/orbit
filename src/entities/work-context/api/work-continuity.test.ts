import { expect, test } from "bun:test";
import {
  safeEventPayload,
  validateFocusTransition,
  validateTransitionInput,
} from "../model/work-continuity";
import { completeWorkItem } from "./completion-repository";

test("blocked transitions require structured interruption fields", () => {
  expect(() => validateTransitionInput({
    workItemId: "a",
    expectedRevision: 0,
    targetStatus: "blocked",
    blockedReason: "API가 500을 반환",
    resumeCondition: "staging 정상 응답 확인",
  })).not.toThrow();
  expect(() => validateTransitionInput({
    workItemId: "a",
    expectedRevision: 0,
    targetStatus: "blocked",
    blockedReason: "API가 500을 반환",
  })).toThrow("재개 조건");
});

test("focus handoff requires checkpoint and next action", () => {
  expect(() => validateFocusTransition({
    currentWorkItemId: "a",
    requestedWorkItemId: "b",
    expectedSlotRevision: 1,
    expectedCurrentRevision: 2,
    expectedRequestedRevision: 0,
    releaseStatus: "todo",
    checkpoint: "응답 변환까지 구현",
    nextAction: "통합 테스트 추가",
  })).not.toThrow();
  expect(() => validateFocusTransition({
    currentWorkItemId: "a",
    requestedWorkItemId: "b",
    expectedSlotRevision: 1,
    expectedCurrentRevision: 2,
    expectedRequestedRevision: 0,
    releaseStatus: "todo",
  })).toThrow("체크포인트");
});

test("activity payload strips bodies and credentials", () => {
  expect(safeEventPayload({
    fromStatus: "focus",
    toStatus: "todo",
    body: "copied slack body",
    token: "secret",
    hasCheckpoint: true,
  })).toEqual({ fromStatus: "focus", toStatus: "todo", hasCheckpoint: true });
});

test("completion repository rejects an incomplete reflection before persistence", async () => {
  await expect(completeWorkItem({
    workItemId: "a",
    expectedRevision: 0,
    resultSummary: "배포 완료",
    decisions: "",
    remainingRisk: "없음",
    retrospective: "테스트를 먼저 작성",
  })).rejects.toThrow("모두 기록");
});
