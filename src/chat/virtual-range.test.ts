import { expect, test } from "bun:test";
import { calculateVirtualRange } from "./virtual-range";

test("renders only rows near the viewport", () => {
  const range = calculateVirtualRange(Array.from({ length: 100 }, () => 100), 4_000, 500, 100);
  expect(range.start).toBe(38);
  expect(range.end).toBe(46);
  expect(range.totalHeight).toBe(10_000);
});

test("handles an empty conversation", () => {
  expect(calculateVirtualRange([], 0, 500)).toEqual({ start: 0, end: 0, offsets: [], totalHeight: 0 });
});
