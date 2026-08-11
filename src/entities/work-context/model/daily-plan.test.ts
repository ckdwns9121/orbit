import { describe, expect, test } from "bun:test";
import { addLocalDays, isDailyPlanActive, localDateKey, nextDailyPriorityRank, reorderDailyPlanIds, reorderDailyPriorityIds, shiftDailyPlanId } from "./daily-plan";

describe("daily plan date", () => {
  test("uses the local calendar date", () => expect(localDateKey(new Date(2026, 7, 11, 23, 30))).toBe("2026-08-11"));
  test("moves across month boundaries", () => expect(addLocalDays("2026-08-31", 1)).toBe("2026-09-01"));
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
});
