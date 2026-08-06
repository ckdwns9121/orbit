import { expect, test } from "bun:test";
import type { WorkItem } from "../domain/work-item";
import { dashboardTaskBuckets, dayRange, periodRange } from "./dashboard-repository";

function task(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: crypto.randomUUID(),
    title: "작업",
    status: "todo",
    priority: null,
    source: "orbit",
    externalId: null,
    externalUrl: null,
    goal: null,
    checkpoint: null,
    nextAction: null,
    doneDefinition: null,
    blockedReason: null,
    resumeCondition: null,
    pausedAt: null,
    lastFocusedAt: null,
    nextReviewAt: null,
    revision: 0,
    targetAt: null,
    reminderSentAt: null,
    position: 0,
    createdAt: "2026-08-01T09:00:00+09:00",
    updatedAt: "2026-08-01T09:00:00+09:00",
    completedAt: null,
    ...overrides,
  };
}

test("dashboard day range follows local midnight", () => {
  const range = dayRange(new Date(2026, 7, 5, 15, 30), -1);
  expect(range.start.getDate()).toBe(4);
  expect(range.start.getHours()).toBe(0);
  expect(range.end.getDate()).toBe(5);
});

test("dashboard period includes today and the preceding local days", () => {
  const range = periodRange(new Date(2026, 7, 6, 15, 30), 7);
  expect(range.start.getDate()).toBe(31);
  expect(range.start.getHours()).toBe(0);
  expect(range.end.getDate()).toBe(7);
  expect(range.end.getHours()).toBe(0);
});

test("dashboard prioritizes active and today-targeted work", () => {
  const { todayTasks } = dashboardTaskBuckets([
    task({ id: "later", targetAt: "2026-08-06T17:00:00+09:00" }),
    task({ id: "active", status: "focus", position: 1 }),
    task({ id: "backlog", status: "todo", position: 2 }),
    task({ id: "earlier", targetAt: "2026-08-06T10:00:00+09:00" }),
  ], new Date("2026-08-06T12:00:00+09:00"));

  expect(todayTasks.map((item) => item.id)).toEqual(["earlier", "later", "active"]);
});

test("dashboard shows only work completed yesterday in the yesterday bucket", () => {
  const { yesterdayTasks } = dashboardTaskBuckets([
    task({ id: "yesterday", status: "done", completedAt: "2026-08-05T18:00:00+09:00" }),
    task({ id: "today", status: "done", completedAt: "2026-08-06T09:00:00+09:00" }),
  ], new Date("2026-08-06T12:00:00+09:00"));

  expect(yesterdayTasks.map((item) => item.id)).toEqual(["yesterday"]);
});
