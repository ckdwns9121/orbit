import { describe, expect, test } from "bun:test";
import { requiresCheckpoint } from "./workflow";

describe("requiresCheckpoint", () => {
  test("집중 작업이 없으면 바로 전환한다", () => {
    expect(requiresCheckpoint(undefined, { targetId: "next", targetStatus: "focus" })).toBe(false);
  });

  test("다른 작업을 집중 상태로 가져오면 체크포인트가 필요하다", () => {
    expect(requiresCheckpoint("current", { targetId: "next", targetStatus: "focus" })).toBe(true);
  });

  test("집중 작업을 AI에게 넘길 때 체크포인트가 필요하다", () => {
    expect(requiresCheckpoint("current", { targetId: "current", targetStatus: "ai_running" })).toBe(true);
  });

  test("집중 작업을 막힘으로 옮길 때 체크포인트가 필요하다", () => {
    expect(requiresCheckpoint("current", { targetId: "current", targetStatus: "blocked" })).toBe(true);
  });

  test("작업 완료는 별도 체크포인트 없이 종료할 수 있다", () => {
    expect(requiresCheckpoint("current", { targetId: "current", targetStatus: "done" })).toBe(false);
  });

  test("집중과 무관한 작업의 상태 변경은 막지 않는다", () => {
    expect(requiresCheckpoint("current", { targetId: "other", targetStatus: "done" })).toBe(false);
  });
});
