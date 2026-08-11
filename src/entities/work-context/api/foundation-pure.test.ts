import { expect, test } from "bun:test";
import type { SourceSyncState } from "../model/work-continuity";
import { assertAllowedAutomationKind } from "./automation-repository";
import { normalizeSourceRefreshError, ScopedSingleFlight, sourceFreshness, safeSyncErrorSummary } from "./source-sync-repository";
import { normalizeTitleTokens } from "./task-template-repository";
import { localWeekRange } from "./weekly-review-repository";

function syncState(overrides: Partial<SourceSyncState> = {}): SourceSyncState {
  return {
    source: "jira", scopeKey: "global", status: "fresh",
    lastAttemptAt: "2026-08-06T00:00:00.000Z",
    lastSuccessAt: "2026-08-06T00:00:00.000Z", itemCount: 3,
    errorCategory: null, errorSummary: null, retryAfterAt: null,
    updatedAt: "2026-08-06T00:00:00.000Z", ...overrides,
  };
}

test("source freshness honors TTL and auth cooldown", () => {
  expect(sourceFreshness(syncState(), 15 * 60_000, new Date("2026-08-06T00:10:00.000Z"))).toBe("fresh");
  expect(sourceFreshness(syncState(), 15 * 60_000, new Date("2026-08-06T00:16:00.000Z"))).toBe("stale");
  expect(sourceFreshness(syncState({
    status: "auth-required", retryAfterAt: "2026-08-06T00:20:00.000Z",
  }), 15 * 60_000, new Date("2026-08-06T00:10:00.000Z"))).toBe("cooldown");
  expect(sourceFreshness(syncState({
    status: "rate-limited", lastSuccessAt: null, retryAfterAt: "2026-08-06T00:20:00.000Z",
  }), 15 * 60_000, new Date("2026-08-06T00:10:00.000Z"))).toBe("cooldown");
  expect(sourceFreshness(syncState({
    status: "auth-required", lastSuccessAt: null, retryAfterAt: "2026-08-06T00:05:00.000Z",
  }), 15 * 60_000, new Date("2026-08-06T00:10:00.000Z"))).toBe("never");
});

test("sync errors redact credentials", () => {
  expect(safeSyncErrorSummary(new Error("Authorization=abc Bearer xyz")))
    .toBe("Authorization=[REDACTED] Bearer [REDACTED]");
});

test("raw and structured Tauri auth/rate-limit errors enter cooldown categories", () => {
  expect(normalizeSourceRefreshError("Jira 인증 또는 이슈 조회 권한을 확인해주세요.").category).toBe("auth");
  expect(normalizeSourceRefreshError("Slack 앱에 missing_scope 토큰 오류가 있습니다.").category).toBe("auth");
  expect(normalizeSourceRefreshError({
    category: "authentication",
    message: "Jira 인증 정보를 확인해주세요.",
    retryable: false,
  }).category).toBe("auth");
  const limited = normalizeSourceRefreshError({
    category: "rate_limited",
    message: "slow down",
    retryAfterSeconds: 30,
  }, new Date("2026-08-07T00:00:00.000Z"));
  expect(limited.category).toBe("rate-limit");
  expect(limited.retryAfterAt).toBe("2026-08-07T00:00:30.000Z");
});

test("single-flight coalesces only identical source and scope", async () => {
  const coordinator = new ScopedSingleFlight();
  let invocations = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = async () => { invocations += 1; await gate; return invocations; };
  const first = coordinator.run("slack", "query:a", operation);
  const same = coordinator.run("slack", "query:a", operation);
  const different = coordinator.run("slack", "query:b", operation);
  expect(invocations).toBe(2);
  release();
  expect(await first).toBe(await same);
  await different;
});

test("template tokens are normalized and stable", () => {
  expect(normalizeTitleTokens("  Jira API API 배포-준비 ")).toEqual(["api", "jira", "배포", "준비"]);
});

test("weekly review uses Monday through Monday", () => {
  const { start, end } = localWeekRange(new Date(2026, 7, 6, 15));
  expect(start.getDay()).toBe(1);
  expect(end.getDay()).toBe(1);
  expect((end.getTime() - start.getTime()) / 86_400_000).toBe(7);
});

test("automation rejects forbidden state mutation", () => {
  expect(() => assertAllowedAutomationKind("auto-complete")).toThrow("자동화할 수 없습니다");
  expect(() => assertAllowedAutomationKind("exact-external-link")).not.toThrow();
});
