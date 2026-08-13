import { describe, expect, test } from "bun:test";
import { addLocalDays, dailyPlanDateForTargetAt, isDailyPlanActive, localDateKey, nextDailyPriorityRank, reorderDailyPlanIds, reorderDailyPriorityIds, shiftDailyPlanId, unplannedWorkItems } from "./daily-plan";
import type { WorkItem } from "./work-item";

describe("daily plan date", () => {
  test("uses the local calendar date", () => expect(localDateKey(new Date(2026, 7, 11, 23, 30))).toBe("2026-08-11"));
  test("moves across month boundaries", () => expect(addLocalDays("2026-08-31", 1)).toBe("2026-09-01"));
  test("maps a target timestamp to its local planner date", () => {
    const target = new Date(2026, 7, 13, 14, 30).toISOString();
    expect(dailyPlanDateForTargetAt(target)).toBe("2026-08-13");
    expect(dailyPlanDateForTargetAt("not-a-date")).toBeNull();
  });
  test("treats carried and skipped items as inactive in Today", () => {
    expect(isDailyPlanActive("planned")).toBeTrue();
    expect(isDailyPlanActive("completed")).toBeTrue();
    expect(isDailyPlanActive("carried")).toBeFalse();
    expect(isDailyPlanActive("skipped")).toBeFalse();
  });
  test("reorders ids by drag target", () => expect(reorderDailyPlanIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]));
  test("shifts ids with keyboard movement", () => expect(shiftDailyPlanId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]));
  test("reorders daily priority ids", () => expect(reorderDailyPriorityIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]));
  test("fills the first empty daily priority rank", () => {
    expect(nextDailyPriorityRank([1, 3])).toBe(2);
    expect(nextDailyPriorityRank([1, 2, 3])).toBeNull();
  });
  test("offers only incomplete tasks without a planner date", () => {
    const base = { goal: null, priority: null, targetAt: null, categoryId: null, position: 0, updatedAt: "2026-08-13T00:00:00.000Z" };
    const items = [
      { ...base, id: "new", title: "새 작업", status: "todo", createdAt: "2026-08-13T02:00:00.000Z" },
      { ...base, id: "planned", title: "배치됨", status: "todo", createdAt: "2026-08-13T01:00:00.000Z" },
      { ...base, id: "done", title: "완료", status: "done", createdAt: "2026-08-13T03:00:00.000Z" },
    ] as WorkItem[];
    expect(unplannedWorkItems(items, ["planned"]).map((item) => item.id)).toEqual(["new"]);
  });
});
