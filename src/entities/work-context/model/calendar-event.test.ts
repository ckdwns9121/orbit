import { describe, expect, test } from "bun:test";
import { addDays, isSameDay, startOfWeek, weekDays } from "./calendar-event";

describe("calendar week", () => {
  test("수요일이 포함된 주는 월요일부터 시작한다", () => {
    const start = startOfWeek(new Date(2026, 7, 5, 12));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(3);
    expect(start.getDay()).toBe(1);
  });

  test("일요일도 이전 월요일이 포함된 주에 배치한다", () => {
    expect(startOfWeek(new Date(2026, 7, 9)).getDate()).toBe(3);
  });

  test("주간 날짜 일곱 개를 만든다", () => {
    const days = weekDays(new Date(2026, 7, 3));
    expect(days).toHaveLength(7);
    expect(days[6].getDate()).toBe(9);
  });

  test("날짜 이동과 같은 날짜 비교가 시간에 영향받지 않는다", () => {
    const start = new Date(2026, 7, 3, 9);
    expect(isSameDay(addDays(start, 2), new Date(2026, 7, 5, 22))).toBe(true);
  });
});
