import { expect, test } from "bun:test";
import { buildSlackToolQuery, parseSearchToolArguments } from "./chat-ai-repository";

test("AI function payload를 Slack 검색 문법으로 변환한다", () => {
  const arguments_ = parseSearchToolArguments({
    query: "원더걸스   유빈",
    date_from: "2024-01-01",
    date_to: "2025-01-01",
  });
  expect(buildSlackToolQuery(arguments_))
    .toBe("원더걸스 유빈 after:2023-12-31 before:2025-01-01");
});

test("날짜가 없는 AI payload에는 Slack 날짜 제한을 추가하지 않는다", () => {
  const arguments_ = parseSearchToolArguments({ query: "원더걸스 유빈", date_from: null, date_to: null });
  expect(buildSlackToolQuery(arguments_)).toBe("원더걸스 유빈");
});

test("잘못된 날짜와 과도한 검색 문자열을 API 호출 전에 정규화한다", () => {
  const arguments_ = parseSearchToolArguments({
    query: `  ${"가".repeat(200)}  `,
    date_from: "2024-02-31",
    date_to: "not-a-date",
  });
  expect(arguments_.query.length).toBe(160);
  expect(arguments_.dateFrom).toBeNull();
  expect(arguments_.dateTo).toBeNull();
});
