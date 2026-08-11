import { describe, expect, test } from "bun:test";
import {
  autoConnectContextCandidates,
  contextMatchScore,
  recommendedContextCandidateIds,
  sortContextCandidates,
} from "./context-discovery";

describe("Task context discovery", () => {
  test("Jira 키가 같으면 강한 관련도로 평가한다", () => {
    expect(contextMatchScore("CGKR-2491 오류 수정", {
      id: "jira:CGKR-2491",
      source: "jira",
      title: "CGKR-2491 · 업로드 오류 수정",
      detail: "진행 중",
    })).toBeGreaterThanOrEqual(70);
  });

  test("AI 세션의 제목과 프롬프트 단어를 함께 비교한다", () => {
    expect(contextMatchScore("OAuth callback 구현", {
      id: "ai:codex:1",
      source: "ai_session",
      title: "로그인 구현",
      detail: "OAuth callback 토큰 저장 방식 확인",
    })).toBeGreaterThan(0);
  });

  test("관련도가 같으면 원래의 최신순을 유지한다", () => {
    const candidates = [
      { id: "first", source: "jira" as const, title: "첫 번째", detail: "" },
      { id: "second", source: "jira" as const, title: "두 번째", detail: "" },
    ];
    expect(sortContextCandidates("관련 없음", candidates).map(({ id }) => id)).toEqual(["first", "second"]);
  });

  test("관련도 60 이상인 후보만 기본 선택한다", () => {
    const selected = recommendedContextCandidateIds([
      { id: "strong", source: "jira", title: "강한 후보", detail: "", score: 88, reason: "" },
      { id: "weak", source: "jira", title: "약한 후보", detail: "", score: 36, reason: "" },
    ]);
    expect([...selected]).toEqual(["strong"]);
  });

  test("자동 연결은 강한 후보 중 상위 세 개만 선택한다", () => {
    const selected = autoConnectContextCandidates([
      { id: "best", source: "ai_session", title: "최상", detail: "", score: 92, reason: "" },
      { id: "near", source: "ai_session", title: "유사", detail: "", score: 81, reason: "" },
      { id: "far", source: "ai_session", title: "낮음", detail: "", score: 70, reason: "" },
      { id: "weak", source: "ai_session", title: "약함", detail: "", score: 42, reason: "" },
    ]);
    expect(selected.map(({ id }) => id)).toEqual(["best", "near"]);
  });
});
