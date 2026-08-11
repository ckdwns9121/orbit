import { describe, expect, test } from "bun:test";
import { taskBoardLaneForStatus } from "./task-board";
import type { WorkItemStatus } from "./work-item";

describe("taskBoardLaneForStatus", () => {
  test("keeps focused work inside the in-progress lane", () => {
    expect(taskBoardLaneForStatus("focus")).toBe("ai_running");
    expect(taskBoardLaneForStatus("ai_running")).toBe("ai_running");
    expect(taskBoardLaneForStatus("done")).toBe("done");
  });

  test("keeps every other work state visible in the todo lane", () => {
    const otherStatuses: WorkItemStatus[] = ["inbox", "todo", "review", "blocked"];
    expect(otherStatuses.map(taskBoardLaneForStatus)).toEqual([
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });
});
