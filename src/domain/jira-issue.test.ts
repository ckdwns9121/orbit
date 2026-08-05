import { describe, expect, test } from "bun:test";
import { jiraProgressStage } from "./jira-issue";

describe("Jira progress stage", () => {
  test("새 티켓은 해야 할 일로 분류한다", () => {
    expect(jiraProgressStage("new")).toBe("todo");
  });

  test("진행 상태 티켓은 진행 중으로 분류한다", () => {
    expect(jiraProgressStage("indeterminate")).toBe("in_progress");
  });

  test("완료 상태 티켓은 완료로 분류한다", () => {
    expect(jiraProgressStage("done")).toBe("done");
  });

  test("알 수 없는 범주는 누락하지 않고 해야 할 일로 분류한다", () => {
    expect(jiraProgressStage("custom")).toBe("todo");
  });
});
