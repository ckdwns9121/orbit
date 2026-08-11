import { expect, test } from "bun:test";
import type { WorkItem } from "./work-item";
import { reorderWorkItemIds, sortWorkItems } from "./work-item-sort";

const item = (id: string, position: number, createdAt: string) => ({
  id, position, createdAt, title: id, status: "todo", priority: null, source: "orbit",
  externalId: null, externalUrl: null, goal: null, checkpoint: null, nextAction: null,
  doneDefinition: null, updatedAt: createdAt, completedAt: null,
}) as WorkItem;

test("Task 정렬은 수동 위치와 생성일 양방향을 지원한다", () => {
  const items = [item("old", 2, "2026-08-01"), item("new", 0, "2026-08-03"), item("middle", 1, "2026-08-02")];
  expect(sortWorkItems(items, "manual").map(({ id }) => id)).toEqual(["new", "middle", "old"]);
  expect(sortWorkItems(items, "newest").map(({ id }) => id)).toEqual(["new", "middle", "old"]);
  expect(sortWorkItems(items, "oldest").map(({ id }) => id)).toEqual(["old", "middle", "new"]);
});

test("드롭 위치에 따라 대상 앞이나 뒤로 이동한다", () => {
  expect(reorderWorkItemIds(["a", "b", "c"], "a", "c", false)).toEqual(["b", "a", "c"]);
  expect(reorderWorkItemIds(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
});
