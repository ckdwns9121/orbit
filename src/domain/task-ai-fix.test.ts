import { describe, expect, test } from "bun:test";
import { validateTaskAiFixPlan } from "./task-ai-fix";

describe("AI Task Fix plan", () => {
  test("validates every task and normalizes target times", () => {
    const plan = validateTaskAiFixPlan({
      summary: " 오늘 할 일을 먼저 정리합니다. ",
      suggestions: [{ id: "a", priority: "p1", targetAt: "2026-08-07T09:00:00+09:00", reason: " 중요함 " }],
    }, ["a"], new Date("2026-08-06T09:00:00+09:00"));
    expect(plan.summary).toBe("오늘 할 일을 먼저 정리합니다.");
    expect(plan.suggestions[0]).toEqual({ id: "a", priority: "p1", targetAt: "2026-08-07T00:00:00.000Z", reason: "중요함" });
  });

  test("rejects missing or past suggestions", () => {
    expect(() => validateTaskAiFixPlan({ summary: "", suggestions: [] }, ["a"])).toThrow();
    expect(() => validateTaskAiFixPlan({
      summary: "",
      suggestions: [{ id: "a", priority: "p2", targetAt: "2020-01-01T00:00:00Z", reason: "past" }],
    }, ["a"])).toThrow();
  });
});
