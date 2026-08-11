import { describe, expect, test } from "bun:test";
import { monthGridDays, parseWeekdays, serializeWeekdays } from "./planner";

describe("simple planner", () => {
  test("builds a Monday-first six week month grid", () => {
    const days = monthGridDays(new Date(2026, 7, 11));
    expect(days).toHaveLength(42);
    expect([days[0].getFullYear(), days[0].getMonth(), days[0].getDate()]).toEqual([2026, 6, 27]);
    expect([days[41].getFullYear(), days[41].getMonth(), days[41].getDate()]).toEqual([2026, 8, 6]);
  });

  test("normalizes routine weekdays", () => {
    expect(parseWeekdays("5,1,1,8,x,0")).toEqual([0, 1, 5]);
    expect(serializeWeekdays([5, 1, 1, -1])).toBe("1,5");
  });
});
