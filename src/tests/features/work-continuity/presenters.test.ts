import { describe, expect, test } from "bun:test";
import type { WorkItem } from "../../../entities/work-context/model/work-item";
import {
  buildContinuityDashboard,
  includesCompletedSearchText,
  pageRange,
  presentFreshness,
  validateCompletion,
  validateInterruption,
} from "../../../features/tasks/work-continuity";

const now = new Date("2026-08-06T12:00:00.000Z");

function item(overrides: Partial<WorkItem> & Record<string, unknown>): WorkItem {
  return {
    id: String(overrides.id ?? "task"),
    title: String(overrides.title ?? "작업"),
    status: overrides.status ?? "todo",
    priority: null,
    source: "orbit",
    externalId: null,
    externalUrl: null,
    goal: null,
    checkpoint: null,
    nextAction: null,
    doneDefinition: null,
    targetAt: null,
    reminderSentAt: null,
    position: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  } as WorkItem;
}

describe("continuity presenters", () => {
  test("orders resume, due blocked, and forgotten tasks without surfacing future review blocks", () => {
    const result = buildContinuityDashboard([
      item({ id: "old", status: "review", updatedAt: "2026-07-20T00:00:00.000Z" }),
      item({ id: "resume", checkpoint: "API 연결", pausedAt: "2026-08-06T11:00:00.000Z" }),
      item({ id: "due", status: "blocked", blockedReason: "권한", nextReviewAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z" }),
      item({ id: "later", status: "blocked", nextReviewAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z" }),
    ], now);
    expect(result.resume?.id).toBe("resume");
    expect(result.blocked.map(({ id }) => id)).toEqual(["due"]);
    expect(result.forgotten.map(({ id }) => id)).toEqual(["old", "due"]);
  });

  test("validates structured interruption only when blocking", () => {
    expect(validateInterruption({ checkpoint: "", nextAction: "", targetStatus: "todo" })).toEqual({
      checkpoint: "현재까지 한 일을 입력하세요.",
      nextAction: "다시 시작할 첫 행동을 입력하세요.",
    });
    expect(validateInterruption({ checkpoint: "완료", nextAction: "재시도", targetStatus: "blocked" })).toEqual({
      blockedReason: "막힌 이유를 입력하세요.",
      resumeCondition: "재개 조건을 입력하세요.",
    });
  });

  test("requires all completion reflection fields", () => {
    expect(Object.keys(validateCompletion({ resultSummary: "", decisions: "", remainingRisks: "", retrospective: "" }))).toEqual([
      "resultSummary", "decisions", "remainingRisks", "retrospective",
    ]);
  });

  test("presents freshness errors without hiding stale cache age", () => {
    expect(presentFreshness({ source: "jira", status: "partial", lastSuccessAt: "2026-08-06T10:00:00.000Z", itemCount: 8, errorSummary: "2개 실패" }, now)).toEqual({
      source: "jira", status: "partial", label: "일부 수집", age: "2시간 전", detail: "2개 실패", needsAttention: true,
    });
  });

  test("searches decisions and evidence labels", () => {
    const record = { title: "OAuth", decisions: "PKCE 사용", evidence: [{ label: "보안 리뷰", url: "https://example.test" }] };
    expect(includesCompletedSearchText(record, "PKCE")).toBeTrue();
    expect(includesCompletedSearchText(record, "보안 리뷰")).toBeTrue();
    expect(includesCompletedSearchText(record, "SSE")).toBeFalse();
  });

  test("calculates stable ranges for the maximum inbox size", () => {
    expect(pageRange(500, 25, 20)).toEqual({
      page: 25,
      pageSize: 20,
      pageCount: 25,
      total: 500,
      start: 480,
      end: 500,
      hasPrevious: true,
      hasNext: false,
    });
  });

  test("clamps invalid and stale page requests", () => {
    expect(pageRange(35, 99, 20)).toMatchObject({ page: 2, start: 20, end: 35 });
    expect(pageRange(35, -3, 20)).toMatchObject({ page: 1, start: 0, end: 20 });
    expect(pageRange(35, Number.NaN, 20)).toMatchObject({ page: 1, start: 0, end: 20 });
  });

  test("keeps empty collections on a harmless first page", () => {
    expect(pageRange(0, 4, 0)).toEqual({
      page: 1,
      pageSize: 1,
      pageCount: 1,
      total: 0,
      start: 0,
      end: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });
});
