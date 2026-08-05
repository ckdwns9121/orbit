import { expect, test } from "bun:test";
import { buildConfluenceToolCql, parseSearchToolArguments } from "./chat-ai-repository";

test("AI function payload를 안전한 Confluence CQL로 변환한다", () => {
  const arguments_ = parseSearchToolArguments({
    query: "피킹 슬립",
    date_from: "2024-01-01",
    date_to: "2025-01-01",
  });
  expect(buildConfluenceToolCql(arguments_))
    .toBe('type = page AND status = current AND text ~ "피킹 슬립" AND lastmodified >= "2024-01-01" AND lastmodified < "2025-01-01"');
});

test("따옴표와 역슬래시는 CQL 문자열에서 제거한다", () => {
  const arguments_ = parseSearchToolArguments({ query: 'Sentry "온콜" \\', date_from: null, date_to: null });
  expect(buildConfluenceToolCql(arguments_))
    .toBe('type = page AND status = current AND text ~ "Sentry 온콜"');
});

test("검색어가 없는 날짜 payload도 문서 기간 검색으로 실행한다", () => {
  const arguments_ = parseSearchToolArguments({ query: "", date_from: "2024-03-01", date_to: "2024-04-01" });
  expect(buildConfluenceToolCql(arguments_))
    .toBe('type = page AND status = current AND lastmodified >= "2024-03-01" AND lastmodified < "2024-04-01"');
});
