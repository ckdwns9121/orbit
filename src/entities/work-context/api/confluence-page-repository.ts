import { invoke } from "@tauri-apps/api/core";
import type { ConfluencePage, ConfluenceSearchResult } from "../model/confluence-page";
import type { SourceSyncState } from "../model/work-continuity";
import { normalizeSourceScope, sourceDefinitions } from "../model/source-capability";
import { getDatabase } from "./database";
import { queryCacheProvenance, type QueryCacheResult } from "./query-cache-provenance";
import { getAppSettings } from "./settings-repository";
import { getSourceSyncState, runScopedSourceRefresh, safeSyncErrorSummary, type ScopedRefreshResult } from "./source-sync-repository";

interface ConfluencePageRow {
  id: string;
  title: string;
  space_key: string;
  excerpt: string;
  url: string;
  last_modified: string;
  discovered_at: string;
}

function toPage(row: ConfluencePageRow): ConfluencePage {
  return {
    id: row.id,
    title: row.title,
    spaceKey: row.space_key,
    excerpt: row.excerpt,
    url: row.url,
    lastModified: row.last_modified,
    discoveredAt: row.discovered_at,
  };
}

function normalizeCql(cql: string): string {
  return cql.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 500);
}

async function listCachedSearch(queryKey: string): Promise<{ searchedAt: string; pages: ConfluencePage[] } | null> {
  const database = await getDatabase();
  const searches = await database.select<Array<{ searched_at: string }>>(
    "SELECT searched_at FROM confluence_searches WHERE query_key = $1",
    [queryKey],
  );
  if (!searches[0]) return null;
  const rows = await database.select<ConfluencePageRow[]>(
    `SELECT pages.id, pages.title, pages.space_key, pages.excerpt, pages.url,
      pages.last_modified, pages.discovered_at
     FROM confluence_search_results results
     JOIN confluence_pages pages ON pages.id = results.page_id
     WHERE results.query_key = $1
     ORDER BY pages.last_modified DESC`,
    [queryKey],
  );
  return { searchedAt: searches[0].searched_at, pages: rows.map(toPage) };
}

export interface ConfluenceSearchDependencies {
  loadCache: typeof listCachedSearch;
  refresh: (cql: string, queryKey: string, scopeKey: string, force?: boolean) => Promise<ScopedRefreshResult<ConfluencePage[]>>;
  readSyncState: (scopeKey: string) => Promise<SourceSyncState | null>;
}

const defaultConfluenceSearchDependencies: ConfluenceSearchDependencies = {
  loadCache: listCachedSearch,
  refresh: (cql, queryKey, scopeKey, force) => runScopedSourceRefresh({
    source: "confluence",
    scopeKey,
    ttlMs: sourceDefinitions.confluence.ttlMs,
    force,
    refresh: async () => {
      const pages = await performConfluenceSearch(cql, queryKey);
      return { data: pages, itemCount: pages.length };
    },
  }),
  readSyncState: (scopeKey) => getSourceSyncState("confluence", scopeKey),
};

export async function searchConfluencePagesWithProvenance(
  cql: string,
  options: { force?: boolean } = {},
  dependencies: ConfluenceSearchDependencies = defaultConfluenceSearchDependencies,
): Promise<QueryCacheResult<ConfluencePage>> {
  const queryKey = normalizeCql(cql);
  if (!queryKey) return { items: [], provenance: queryCacheProvenance(null, "remote") };
  const scope = normalizeSourceScope("confluence", queryKey);
  const cached = await dependencies.loadCache(queryKey);
  try {
    const result = await dependencies.refresh(cql, queryKey, scope.scopeKey, options.force);
    if (result.data) {
      return { items: result.data, provenance: queryCacheProvenance(result.state, "remote") };
    }
    const cache = await dependencies.loadCache(queryKey);
    return {
      items: cache?.pages ?? [],
      provenance: queryCacheProvenance(result.state, "cache", cache?.searchedAt ?? cached?.searchedAt ?? null),
    };
  } catch (cause) {
    if (cached?.pages.length) {
      const failedState = await dependencies.readSyncState(scope.scopeKey).catch(() => null);
      return {
        items: cached.pages,
        provenance: queryCacheProvenance(
          failedState,
          "cache",
          cached.searchedAt,
          safeSyncErrorSummary(cause),
        ),
      };
    }
    throw cause;
  }
}

export async function searchConfluencePages(cql: string, options: { force?: boolean } = {}): Promise<ConfluencePage[]> {
  return (await searchConfluencePagesWithProvenance(cql, options)).items;
}

async function performConfluenceSearch(cql: string, queryKey: string): Promise<ConfluencePage[]> {
  const settings = await getAppSettings();
  if (!settings.jira_url || !settings.jira_email) {
    throw new Error("Settings에서 Atlassian 사이트 URL과 이메일을 입력해주세요.");
  }

  const result = await invoke<ConfluenceSearchResult>("search_confluence_pages", {
    jiraUrl: settings.jira_url,
    jiraEmail: settings.jira_email,
    cql,
  });

  const database = await getDatabase();
  const discoveredAt = new Date().toISOString();
  await database.execute(
    `INSERT INTO confluence_searches (query_key, cql, searched_at) VALUES ($1, $2, $3)
     ON CONFLICT(query_key) DO UPDATE SET cql = excluded.cql, searched_at = excluded.searched_at`,
    [queryKey, result.cql, discoveredAt],
  );
  const currentResults = await database.select<Array<{ page_id: string }>>(
    "SELECT page_id FROM confluence_search_results WHERE query_key = $1",
    [queryKey],
  );
  const nextPageIds = new Set(result.pages.map((page) => page.id));
  for (const page of result.pages) {
    await database.execute(
      `INSERT INTO confluence_pages (
        id, title, space_key, excerpt, url, last_modified, discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, space_key = excluded.space_key,
        excerpt = excluded.excerpt, url = excluded.url, last_modified = excluded.last_modified,
        discovered_at = excluded.discovered_at`,
      [page.id, page.title, page.spaceKey, page.excerpt, page.url, page.lastModified, discoveredAt],
    );
    await database.execute(
      "INSERT OR IGNORE INTO confluence_search_results (query_key, page_id) VALUES ($1, $2)",
      [queryKey, page.id],
    );
  }
  // Reconcile only after every new record/link has been safely upserted.
  for (const current of currentResults) {
    if (!nextPageIds.has(current.page_id)) {
      await database.execute(
        "DELETE FROM confluence_search_results WHERE query_key = $1 AND page_id = $2",
        [queryKey, current.page_id],
      );
    }
  }
  return result.pages.map((page) => ({ ...page, discoveredAt }));
}
