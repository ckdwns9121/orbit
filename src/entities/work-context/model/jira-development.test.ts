import { describe, expect, test } from "bun:test";
import {
  JIRA_DEVELOPMENT_CACHE_TTL_MS,
  shouldRefreshJiraDevelopment,
  type CachedJiraIssueDevelopment,
} from "./jira-development";

const cached = (syncedAt: string) => ({ syncedAt } as CachedJiraIssueDevelopment);

describe("Jira development cache", () => {
  test("캐시가 없으면 GitHub 정보를 다시 조회한다", () => {
    expect(shouldRefreshJiraDevelopment(null)).toBe(true);
  });

  test("30분 이내 캐시는 그대로 사용한다", () => {
    const now = Date.parse("2026-08-05T12:30:00.000Z");
    expect(shouldRefreshJiraDevelopment(cached("2026-08-05T12:10:00.000Z"), now)).toBe(false);
  });

  test("30분이 지난 캐시는 갱신한다", () => {
    const now = Date.parse("2026-08-05T12:30:00.000Z");
    expect(shouldRefreshJiraDevelopment(
      cached(new Date(now - JIRA_DEVELOPMENT_CACHE_TTL_MS).toISOString()),
      now,
    )).toBe(true);
  });
});
