import { describe, expect, test } from "bun:test";
import { taskProposalFromToolCall } from "./chat-task-proposal";

describe("taskProposalFromToolCall", () => {
  test("normalizes a structured create-task proposal", () => {
    expect(taskProposalFromToolCall({
      callId: "call_1",
      name: "create_task",
      arguments: { title: "  배포   체크리스트 확인  ", description: "  누락된 항목을 확인한다.  " },
    })).toEqual({
      id: "call_1",
      title: "배포 체크리스트 확인",
      description: "누락된 항목을 확인한다.",
      status: "pending",
    });
  });

  test("rejects an empty title and keeps description optional", () => {
    expect(taskProposalFromToolCall({ callId: "empty", name: "create_task", arguments: { title: "  " } })).toBeNull();
    expect(taskProposalFromToolCall({ callId: "valid", name: "create_task", arguments: { title: "리뷰하기", description: null } })?.description).toBeNull();
  });
});
