import { expect, test } from "bun:test";
import { dayRange, periodRange } from "./dashboard-repository";

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
