import { describe, expect, test } from "bun:test";
import { taskStatusSuggestionForSessions } from "./task-flow";

describe("AI session Task suggestions", () => {
  test("세션이 없으면 상태 변경을 제안하지 않는다", () => {
    expect(taskStatusSuggestionForSessions([])).toBeNull();
  });

  test("하나라도 진행 중이면 진행 중 상태를 제안한다", () => {
    expect(taskStatusSuggestionForSessions(["done", "active"])).toBe("ai_running");
  });

  test("연결된 세션이 모두 완료돼도 완료하지 않고 검토를 제안한다", () => {
    expect(taskStatusSuggestionForSessions(["done", "done"])).toBe("review");
  });
});
