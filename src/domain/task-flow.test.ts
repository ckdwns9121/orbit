import { describe, expect, test } from "bun:test";
import { taskStatusForSessions } from "./task-flow";

describe("simple Task flow", () => {
  test("세션이 없으면 할 일이다", () => {
    expect(taskStatusForSessions([])).toBe("todo");
  });

  test("하나라도 진행 중이면 Task도 진행 중이다", () => {
    expect(taskStatusForSessions(["done", "active"])).toBe("ai_running");
  });

  test("연결된 세션이 모두 완료되면 Task도 완료된다", () => {
    expect(taskStatusForSessions(["done", "done"])).toBe("done");
  });
});
