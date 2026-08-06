import type { SourceSyncState, SyncSource, SyncStatus } from "../domain/work-continuity";
import { getDatabase } from "./database";

interface SourceSyncRow {
  source: SyncSource;
  scope_key: string;
  status: SyncStatus;
  last_attempt_at: string | null;
  last_success_at: string | null;
  item_count: number;
  error_category: string | null;
  error_summary: string | null;
  retry_after_at: string | null;
  updated_at: string;
}

export interface SourceRefreshOutcome<T> {
  data: T;
  itemCount: number;
  status?: "fresh" | "partial";
  errorCategory?: string | null;
  errorSummary?: string | null;
}

export interface ScopedRefreshResult<T> {
  data: T | null;
  refreshed: boolean;
  state: SourceSyncState;
}

export interface SourceRefreshError extends Error {
  category?: "auth" | "rate-limit" | "network" | "server" | "validation";
  retryAfterAt?: string;
}

export function normalizeSourceRefreshError(
  cause: unknown,
  now = new Date(),
): SourceRefreshError {
  const candidate = cause && typeof cause === "object"
    ? cause as { category?: unknown; message?: unknown; retryAfterSeconds?: unknown; retryAfterAt?: unknown }
    : null;
  const rawCategory = typeof candidate?.category === "string" ? candidate.category : "";
  const message = typeof candidate?.message === "string"
    ? candidate.message
    : cause instanceof Error ? cause.message : String(cause ?? "동기화에 실패했습니다.");
  const searchable = `${rawCategory} ${message}`.toLocaleLowerCase();
  const category: SourceRefreshError["category"] =
    ["authentication", "authorization", "auth"].includes(rawCategory)
      || /\b(401|403)\b|인증|권한|missing_scope|not_allowed_token_type|토큰|자격 증명|keychain/.test(searchable)
      ? "auth"
      : ["rate_limited", "rate-limit"].includes(rawCategory)
        || /\b429\b|호출 한도|rate.?limit/.test(searchable)
        ? "rate-limit"
        : rawCategory === "network" || /network|timeout|timed out|연결하지 못|네트워크/.test(searchable)
          ? "network"
          : ["unavailable", "invalid_response", "server"].includes(rawCategory)
            || /\b5\d\d\b/.test(searchable)
            ? "server"
            : ["invalid_request", "not_found", "stale_approval", "conflict", "validation"].includes(rawCategory)
              ? "validation"
              : undefined;
  const error = new Error(message) as SourceRefreshError;
  error.category = category;
  if (typeof candidate?.retryAfterAt === "string") {
    error.retryAfterAt = candidate.retryAfterAt;
  } else if (typeof candidate?.retryAfterSeconds === "number" && Number.isFinite(candidate.retryAfterSeconds)) {
    error.retryAfterAt = new Date(now.getTime() + Math.max(0, candidate.retryAfterSeconds) * 1_000).toISOString();
  }
  return error;
}

function mapRow(row: SourceSyncRow): SourceSyncState {
  return {
    source: row.source,
    scopeKey: row.scope_key,
    status: row.status,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    itemCount: row.item_count,
    errorCategory: row.error_category,
    errorSummary: row.error_summary,
    retryAfterAt: row.retry_after_at,
    updatedAt: row.updated_at,
  };
}

export function sourceFreshness(
  state: SourceSyncState | null,
  ttlMs: number,
  now = new Date(),
): "never" | "fresh" | "stale" | "cooldown" {
  if ((state?.status === "auth-required" || state?.status === "rate-limited")
    && state.retryAfterAt && Date.parse(state.retryAfterAt) > now.getTime()) {
    return "cooldown";
  }
  if (!state?.lastSuccessAt) return "never";
  const age = now.getTime() - Date.parse(state.lastSuccessAt);
  return Number.isFinite(age) && age <= ttlMs ? "fresh" : "stale";
}

export function safeSyncErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|authorization|cookie)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 240);
}

export async function getSourceSyncState(
  source: SyncSource,
  scopeKey: string,
): Promise<SourceSyncState | null> {
  const database = await getDatabase();
  const rows = await database.select<SourceSyncRow[]>(
    `SELECT source, scope_key, status, last_attempt_at, last_success_at, item_count,
      error_category, error_summary, retry_after_at, updated_at
     FROM source_sync_state WHERE source = $1 AND scope_key = $2`,
    [source, scopeKey],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listSourceSyncStates(): Promise<SourceSyncState[]> {
  const database = await getDatabase();
  const rows = await database.select<SourceSyncRow[]>(
    `SELECT source, scope_key, status, last_attempt_at, last_success_at, item_count,
      error_category, error_summary, retry_after_at, updated_at
     FROM source_sync_state ORDER BY source, scope_key`,
  );
  return rows.map(mapRow);
}

async function saveSourceSyncState(state: SourceSyncState): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO source_sync_state(
      source, scope_key, status, last_attempt_at, last_success_at, item_count,
      error_category, error_summary, retry_after_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(source, scope_key) DO UPDATE SET
      status = excluded.status, last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at, item_count = excluded.item_count,
      error_category = excluded.error_category, error_summary = excluded.error_summary,
      retry_after_at = excluded.retry_after_at, updated_at = excluded.updated_at`,
    [state.source, state.scopeKey, state.status, state.lastAttemptAt, state.lastSuccessAt,
      state.itemCount, state.errorCategory, state.errorSummary, state.retryAfterAt, state.updatedAt],
  );
}

export class ScopedSingleFlight {
  private readonly active = new Map<string, Promise<unknown>>();

  run<T>(source: SyncSource, scopeKey: string, operation: () => Promise<T>): Promise<T> {
    const key = `${source}\u0000${scopeKey}`;
    const existing = this.active.get(key);
    if (existing) return existing as Promise<T>;
    const promise = operation();
    this.active.set(key, promise);
    void promise.finally(() => this.active.delete(key)).catch(() => undefined);
    return promise;
  }
}

const refreshCoordinator = new ScopedSingleFlight();

export async function runScopedSourceRefresh<T>(input: {
  source: SyncSource;
  scopeKey: string;
  ttlMs: number;
  force?: boolean;
  now?: () => Date;
  refresh: () => Promise<SourceRefreshOutcome<T>>;
}): Promise<ScopedRefreshResult<T>> {
  if (!input.scopeKey.trim()) throw new Error("동기화 범위 키는 비워둘 수 없습니다.");
  return refreshCoordinator.run(input.source, input.scopeKey, async () => {
    const now = input.now?.() ?? new Date();
    const current = await getSourceSyncState(input.source, input.scopeKey);
    const freshness = sourceFreshness(current, input.ttlMs, now);
    if (!input.force && (freshness === "fresh" || freshness === "cooldown")) {
      return {
        data: null,
        refreshed: false,
        state: current ?? {
          source: input.source, scopeKey: input.scopeKey, status: "never",
          lastAttemptAt: null, lastSuccessAt: null, itemCount: 0, errorCategory: null,
          errorSummary: null, retryAfterAt: null, updatedAt: now.toISOString(),
        },
      };
    }

    const attemptAt = now.toISOString();
    await saveSourceSyncState({
      source: input.source,
      scopeKey: input.scopeKey,
      status: "syncing",
      lastAttemptAt: attemptAt,
      lastSuccessAt: current?.lastSuccessAt ?? null,
      itemCount: current?.itemCount ?? 0,
      errorCategory: null,
      errorSummary: null,
      retryAfterAt: null,
      updatedAt: attemptAt,
    });
    try {
      const outcome = await input.refresh();
      const completedAt = (input.now?.() ?? new Date()).toISOString();
      const state: SourceSyncState = {
        source: input.source,
        scopeKey: input.scopeKey,
        status: outcome.status ?? "fresh",
        lastAttemptAt: attemptAt,
        lastSuccessAt: completedAt,
        itemCount: outcome.itemCount,
        errorCategory: outcome.errorCategory ?? null,
        errorSummary: outcome.errorSummary?.slice(0, 240) ?? null,
        retryAfterAt: null,
        updatedAt: completedAt,
      };
      await saveSourceSyncState(state);
      return { data: outcome.data, refreshed: true, state };
    } catch (unknownError) {
      const failedAt = (input.now?.() ?? new Date()).toISOString();
      const error = normalizeSourceRefreshError(unknownError, new Date(failedAt));
      const status: SyncStatus = error.category === "auth"
        ? "auth-required"
        : error.category === "rate-limit" ? "rate-limited" : "failed";
      const retryAfterAt = error.retryAfterAt
        ?? (status === "auth-required"
          ? new Date(Date.parse(failedAt) + 5 * 60_000).toISOString()
          : status === "rate-limited"
            ? new Date(Date.parse(failedAt) + 60_000).toISOString()
            : null);
      const state: SourceSyncState = {
        source: input.source,
        scopeKey: input.scopeKey,
        status,
        lastAttemptAt: attemptAt,
        lastSuccessAt: current?.lastSuccessAt ?? null,
        itemCount: current?.itemCount ?? 0,
        errorCategory: error.category ?? "unknown",
        errorSummary: safeSyncErrorSummary(error),
        retryAfterAt,
        updatedAt: failedAt,
      };
      await saveSourceSyncState(state);
      throw error;
    }
  });
}
