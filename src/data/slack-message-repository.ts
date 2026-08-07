import { invoke } from "@tauri-apps/api/core";
import type { SlackMessage, SlackSearchResult } from "../domain/slack-message";
import type { SourceSyncState } from "../domain/work-continuity";
import { normalizeSourceScope, sourceDefinitions } from "../sources/source-capability";
import { getDatabase } from "./database";
import { queryCacheProvenance, type QueryCacheResult } from "./query-cache-provenance";
import { getSourceSyncState, runScopedSourceRefresh, safeSyncErrorSummary, type ScopedRefreshResult } from "./source-sync-repository";

interface SlackMessageRow {
  id: string;
  channel_id: string;
  channel_name: string;
  user_name: string;
  text: string;
  permalink: string;
  message_ts: string;
  discovered_at: string;
}

function toMessage(row: SlackMessageRow): SlackMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    userName: row.user_name,
    text: row.text,
    permalink: row.permalink,
    messageTs: row.message_ts,
    discoveredAt: row.discovered_at,
  };
}

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 200);
}

async function listCachedSearch(queryKey: string): Promise<{ searchedAt: string; messages: SlackMessage[] } | null> {
  const database = await getDatabase();
  const searches = await database.select<Array<{ searched_at: string }>>(
    "SELECT searched_at FROM slack_searches WHERE query_key = $1",
    [queryKey],
  );
  if (!searches[0]) return null;
  const rows = await database.select<SlackMessageRow[]>(
    `SELECT messages.id, messages.channel_id, messages.channel_name, messages.user_name,
      messages.text, messages.permalink, messages.message_ts, messages.discovered_at
     FROM slack_search_results results
     JOIN slack_messages messages ON messages.id = results.message_id
     WHERE results.query_key = $1
     ORDER BY messages.message_ts DESC`,
    [queryKey],
  );
  return { searchedAt: searches[0].searched_at, messages: rows.map(toMessage) };
}

export interface SlackSearchDependencies {
  loadExactCache: typeof listCachedSearch;
  loadRelatedCache: typeof listRelatedCachedSlackMessages;
  refresh: (query: string, queryKey: string, scopeKey: string, force?: boolean) => Promise<ScopedRefreshResult<SlackMessage[]>>;
  readSyncState: (scopeKey: string) => Promise<SourceSyncState | null>;
}

export async function listRelatedCachedSlackMessages(query: string, limit = 30): Promise<SlackMessage[]> {
  const database = await getDatabase();
  const rows = await database.select<SlackMessageRow[]>(
    `SELECT id, channel_id, channel_name, user_name, text, permalink, message_ts, discovered_at
     FROM slack_messages ORDER BY message_ts DESC LIMIT 250`,
  );
  const tokens = normalizeQuery(query).split(" ").filter((token) => token.length > 1);
  return rows
    .map(toMessage)
    .map((message) => ({
      message,
      score: tokens.reduce((score, token) => score + (message.text.toLocaleLowerCase().includes(token) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.message.messageTs.localeCompare(left.message.messageTs))
    .slice(0, limit)
    .map((item) => item.message);
}

const defaultSlackSearchDependencies: SlackSearchDependencies = {
  loadExactCache: listCachedSearch,
  loadRelatedCache: listRelatedCachedSlackMessages,
  refresh: (query, queryKey, scopeKey, force) => runScopedSourceRefresh({
    source: "slack",
    scopeKey,
    ttlMs: sourceDefinitions.slack.ttlMs,
    force,
    refresh: async () => {
      const messages = await performSlackSearch(query, queryKey);
      return { data: messages, itemCount: messages.length };
    },
  }),
  readSyncState: (scopeKey) => getSourceSyncState("slack", scopeKey),
};

export async function searchSlackMessagesWithProvenance(
  query: string,
  options: { force?: boolean } = {},
  dependencies: SlackSearchDependencies = defaultSlackSearchDependencies,
): Promise<QueryCacheResult<SlackMessage>> {
  const queryKey = normalizeQuery(query);
  if (!queryKey) return { items: [], provenance: queryCacheProvenance(null, "remote") };
  const scope = normalizeSourceScope("slack", queryKey);
  const cached = await dependencies.loadExactCache(queryKey);
  try {
    const result = await dependencies.refresh(query, queryKey, scope.scopeKey, options.force);
    if (result.data) {
      return { items: result.data, provenance: queryCacheProvenance(result.state, "remote") };
    }
    const cache = await dependencies.loadExactCache(queryKey);
    return {
      items: cache?.messages ?? [],
      provenance: queryCacheProvenance(result.state, "cache", cache?.searchedAt ?? cached?.searchedAt ?? null),
    };
  } catch (cause) {
    const fallback = cached?.messages.length ? cached.messages : await dependencies.loadRelatedCache(query);
    if (fallback.length) {
      const failedState = await dependencies.readSyncState(scope.scopeKey).catch(() => null);
      return {
        items: fallback,
        provenance: queryCacheProvenance(
          failedState,
          "cache",
          cached?.searchedAt ?? null,
          safeSyncErrorSummary(cause),
        ),
      };
    }
    throw cause;
  }
}

export async function searchSlackMessages(query: string, options: { force?: boolean } = {}): Promise<SlackMessage[]> {
  return (await searchSlackMessagesWithProvenance(query, options)).items;
}

async function performSlackSearch(query: string, queryKey: string): Promise<SlackMessage[]> {
  const result = await invoke<SlackSearchResult>("search_slack_messages", { query });

  const database = await getDatabase();
  const discoveredAt = new Date().toISOString();
  await database.execute(
    `INSERT INTO slack_searches (query_key, query, searched_at) VALUES ($1, $2, $3)
     ON CONFLICT(query_key) DO UPDATE SET query = excluded.query, searched_at = excluded.searched_at`,
    [queryKey, result.query, discoveredAt],
  );
  const currentResults = await database.select<Array<{ message_id: string }>>(
    "SELECT message_id FROM slack_search_results WHERE query_key = $1",
    [queryKey],
  );
  const nextMessageIds = new Set(result.messages.map((message) => message.id));
  for (const message of result.messages) {
    await database.execute(
      `INSERT INTO slack_messages (
        id, channel_id, channel_name, user_name, text, permalink, message_ts, discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id,
        channel_name = excluded.channel_name, user_name = excluded.user_name,
        text = excluded.text, permalink = excluded.permalink,
        message_ts = excluded.message_ts, discovered_at = excluded.discovered_at`,
      [message.id, message.channelId, message.channelName, message.userName, message.text, message.permalink, message.messageTs, discoveredAt],
    );
    await database.execute(
      "INSERT OR IGNORE INTO slack_search_results (query_key, message_id) VALUES ($1, $2)",
      [queryKey, message.id],
    );
  }
  // Reconcile only after every new record/link has been safely upserted.
  for (const current of currentResults) {
    if (!nextMessageIds.has(current.message_id)) {
      await database.execute(
        "DELETE FROM slack_search_results WHERE query_key = $1 AND message_id = $2",
        [queryKey, current.message_id],
      );
    }
  }
  return result.messages.map((message) => ({ ...message, discoveredAt }));
}
