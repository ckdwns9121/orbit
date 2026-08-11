import { describe, expect, test } from "bun:test";
import {
  displaySessionPrompt,
  displaySessionTitle,
  isInternalSessionText,
  projectName,
  sessionActivity,
  type AiSession,
} from "./ai-session";

const session = {
  provider: "codex",
  sessionId: "1",
  title: "Orbit workspace",
  cwd: "/Users/me/orbit",
  model: null,
  firstPrompt: null,
  lastPrompt: null,
  createdAt: null,
  updatedAt: null,
  modifiedAtMs: 1_000,
  messageCount: 2,
  customTitle: null,
  completionState: "active",
  acknowledgedAtMs: 900,
  linkedWorkItemId: null,
} satisfies AiSession;

describe("AI session activity", () => {
  test("separates recent file activity from unread changes", () => {
    expect(sessionActivity(session, 1_500)).toEqual({ isRecentlyActive: true, needsAttention: true });
  });

  test("derives a project label from cwd", () => {
    expect(projectName(session.cwd)).toBe("orbit");
    expect(projectName(null)).toBe("프로젝트 없음");
  });

  test("hides injected environment context from titles and prompts", () => {
    const injected = "<environment_context> <cwd>/Users/me/orbit</cwd> </environment_context>";
    const noisy = { ...session, title: injected, firstPrompt: injected, lastPrompt: "실제 작업 요청" };
    expect(isInternalSessionText(injected)).toBe(true);
    expect(displaySessionTitle(noisy)).toBe("실제 작업 요청");
    expect(displaySessionPrompt(injected)).toBeNull();
  });

  test("uses the Orbit session alias before the transcript title", () => {
    expect(displaySessionTitle({ ...session, customTitle: "로그인 오류 수정 세션" }))
      .toBe("로그인 오류 수정 세션");
  });
});
