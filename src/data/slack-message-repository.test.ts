import { expect, test } from "bun:test";
import { buildSlackDateFilter, buildSlackSearchQuery } from "./chat-ai-repository";
import type { ChatMessage } from "../domain/chat";

function userMessage(content: string): ChatMessage {
  return { id: crypto.randomUUID(), threadId: "thread", role: "user", content, responseId: null, createdAt: new Date().toISOString() };
}

test("현재 질문에서 Slack 검색 핵심어를 만든다", () => {
  expect(buildSlackSearchQuery("피킹 슬립 에러 찾아줘", [])).toBe("피킹 슬립 에러");
});

test("대명사형 후속 질문은 직전 사용자 질문의 핵심어를 사용한다", () => {
  expect(buildSlackSearchQuery("다시 찾아봐", [userMessage("CO-9 피킹 슬립 SKU 누락 오류를 확인해줘")])).toBe("CO-9 피킹 슬립 SKU");
});

test("연도 표현을 Slack 날짜 범위로 변환한다", () => {
  expect(buildSlackSearchQuery("2024년에 총량피킹 관련 작업 찾아줘봐", [])).toBe("총량피킹 after:2023-12-31 before:2025-01-01");
});

test("연월과 특정 날짜를 정확한 Slack 필터로 변환한다", () => {
  expect(buildSlackDateFilter("2024년 3월 대화")).toBe("after:2024-02-29 before:2024-04-01");
  expect(buildSlackDateFilter("2024년 3월 15일 대화")).toBe("on:2024-03-15");
});

test("상대 날짜를 로컬 날짜 기준 Slack 필터로 변환한다", () => {
  const now = new Date(2026, 7, 6, 12);
  expect(buildSlackDateFilter("어제 대화", now)).toBe("on:2026-08-05");
  expect(buildSlackDateFilter("지난 주 작업", now)).toBe("after:2026-07-26 before:2026-08-03");
});

test("후속 질문의 날짜와 이전 질문의 주제를 결합한다", () => {
  const previous = userMessage("총량피킹 SKU 누락 대화 찾아줘");
  expect(buildSlackSearchQuery("2024년으로 다시 찾아봐", [previous])).toBe("총량피킹 SKU 누락 after:2023-12-31 before:2025-01-01");
});
