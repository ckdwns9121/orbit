import { describe, expect, test } from "bun:test";
import type { ConfluencePage } from "../domain/confluence-page";
import type { SlackMessage } from "../domain/slack-message";
import type { SourceSyncState } from "../domain/work-continuity";
import { buildChatQueryCacheContext } from "./chat-ai-repository";
import { searchConfluencePagesWithProvenance } from "./confluence-page-repository";
import { searchSlackMessagesWithProvenance } from "./slack-message-repository";

const failedState = (source: "slack" | "confluence"): SourceSyncState => ({
  source,
  scopeKey: "query-scope",
  status: "failed",
  lastAttemptAt: "2026-08-07T01:05:00.000Z",
  lastSuccessAt: "2026-08-06T23:00:00.000Z",
  itemCount: 1,
  errorCategory: "network",
  errorSummary: "remote request timed out",
  retryAfterAt: null,
  updatedAt: "2026-08-07T01:05:01.000Z",
});

const slackMessage: SlackMessage = {
  id: "message-1",
  channelId: "C1",
  channelName: "oncall",
  userName: "Ada",
  text: "결제 재시도 장애를 확인했습니다.",
  permalink: "https://example.slack.com/archives/C1/p1",
  messageTs: "1722990000.000000",
  discoveredAt: "2026-08-06T23:00:00.000Z",
};

const confluencePage: ConfluencePage = {
  id: "page-1",
  title: "결제 장애 대응",
  spaceKey: "PAY",
  excerpt: "재시도 장애 대응 절차",
  url: "https://example.atlassian.net/wiki/spaces/PAY/pages/1",
  lastModified: "2026-08-06T22:00:00.000Z",
  discoveredAt: "2026-08-06T23:00:00.000Z",
};

describe("query cache failure provenance", () => {
  test("Slack returns stale cache with the persisted remote failure provenance", async () => {
    const syncState = failedState("slack");
    const result = await searchSlackMessagesWithProvenance("결제 장애", {}, {
      loadExactCache: async () => ({ searchedAt: "2026-08-06T23:00:00.000Z", messages: [slackMessage] }),
      loadRelatedCache: async () => [],
      refresh: async () => { throw new Error("remote request timed out"); },
      readSyncState: async () => syncState,
    });

    expect(result.items).toEqual([slackMessage]);
    expect(result.provenance).toEqual({
      origin: "cache",
      freshness: "stale-cache",
      lastAttemptAt: syncState.lastAttemptAt,
      lastSuccessAt: syncState.lastSuccessAt,
      errorCategory: "network",
      errorSummary: "remote request timed out",
    });
    expect(syncState.status).toBe("failed");
  });

  test("Confluence returns stale cache without converting failure to fresh", async () => {
    const syncState = failedState("confluence");
    const result = await searchConfluencePagesWithProvenance("type = page", {}, {
      loadCache: async () => ({ searchedAt: "2026-08-06T23:00:00.000Z", pages: [confluencePage] }),
      refresh: async () => { throw new Error("remote request timed out"); },
      readSyncState: async () => syncState,
    });

    expect(result.items).toEqual([confluencePage]);
    expect(result.provenance.freshness).toBe("stale-cache");
    expect(result.provenance.errorCategory).toBe("network");
    expect(syncState.status).toBe("failed");
  });

  test("Chat grounding explicitly labels cached results as stale and names the remote error", () => {
    const context = buildChatQueryCacheContext("Slack", {
      origin: "cache",
      freshness: "stale-cache",
      lastAttemptAt: "2026-08-07T01:05:00.000Z",
      lastSuccessAt: "2026-08-06T23:00:00.000Z",
      errorCategory: "network",
      errorSummary: "remote request timed out",
    });

    expect(context.freshness).toBe("stale-cache");
    expect(context.warning).toContain("실시간 검색 결과가 아니라 오래된 로컬 캐시");
    expect(context.warning).toContain("마지막 성공: 2026-08-06T23:00:00.000Z");
    expect(context.warning).toContain("원격 오류: remote request timed out");
    expect(context.remoteErrorCategory).toBe("network");
  });

  test("a TTL-valid cache hit remains fresh and carries no stale warning", async () => {
    const state: SourceSyncState = {
      ...failedState("slack"),
      status: "fresh",
      errorCategory: null,
      errorSummary: null,
    };
    const result = await searchSlackMessagesWithProvenance("결제 장애", {}, {
      loadExactCache: async () => ({ searchedAt: state.lastSuccessAt!, messages: [slackMessage] }),
      loadRelatedCache: async () => [],
      refresh: async () => ({ data: null, refreshed: false, state }),
      readSyncState: async () => state,
    });
    const context = buildChatQueryCacheContext("Slack", result.provenance);

    expect(result.provenance.freshness).toBe("fresh-cache");
    expect(context.warning).toBeNull();
  });
});
