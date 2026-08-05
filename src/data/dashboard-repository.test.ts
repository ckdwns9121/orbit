import { expect, test } from "bun:test";
import { dayRange } from "./dashboard-repository";

test("dashboard day range follows local midnight", () => {
  const range = dayRange(new Date(2026, 7, 5, 15, 30), -1);
  expect(range.start.getDate()).toBe(4);
  expect(range.start.getHours()).toBe(0);
  expect(range.end.getDate()).toBe(5);
});
