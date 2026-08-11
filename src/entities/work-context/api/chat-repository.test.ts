import { expect, test } from "bun:test";
import { makeThreadTitle } from "./chat-repository";

test("chat thread title is compact and deterministic", () => {
  expect(makeThreadTitle("  오늘   일정 뭐야? ")).toBe("오늘 일정 뭐야?");
  expect(makeThreadTitle("가".repeat(40))).toBe(`${"가".repeat(32)}…`);
});
