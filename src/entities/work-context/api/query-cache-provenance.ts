import type { SourceSyncState } from "../model/work-continuity";

export type QueryCacheFreshness = "fresh" | "fresh-cache" | "partial" | "stale-cache";

export interface QueryCacheProvenance {
  origin: "remote" | "cache";
  freshness: QueryCacheFreshness;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  errorCategory: string | null;
  errorSummary: string | null;
}

export interface QueryCacheResult<T> {
  items: T[];
  provenance: QueryCacheProvenance;
}

export function queryCacheProvenance(
  state: SourceSyncState | null,
  origin: QueryCacheProvenance["origin"],
  cachedAt: string | null = null,
  fallbackError: string | null = null,
): QueryCacheProvenance {
  const freshness: QueryCacheFreshness = origin === "remote"
    ? state?.status === "partial" ? "partial" : "fresh"
    : fallbackError !== null ? "stale-cache"
      : state?.status === "partial" ? "partial"
        : state?.status === "fresh" ? "fresh-cache" : "stale-cache";
  return {
    origin,
    freshness,
    lastAttemptAt: state?.lastAttemptAt ?? null,
    lastSuccessAt: state?.lastSuccessAt ?? cachedAt,
    errorCategory: state?.errorCategory ?? null,
    errorSummary: state?.errorSummary ?? fallbackError,
  };
}

export function queryCacheWarning(label: string, provenance: QueryCacheProvenance): string | null {
  if (provenance.freshness === "stale-cache") {
    const lastSuccess = provenance.lastSuccessAt ? ` 마지막 성공: ${provenance.lastSuccessAt}.` : " 마지막 성공 시각은 알 수 없습니다.";
    const error = provenance.errorSummary ? ` 원격 오류: ${provenance.errorSummary}` : " 원격 검색에 실패했습니다.";
    return `${label} 실시간 검색 결과가 아니라 오래된 로컬 캐시입니다.${lastSuccess}${error}`;
  }
  if (provenance.freshness === "partial") {
    return `${label} 원격 검색이 일부 결과만 반환했습니다.${provenance.errorSummary ? ` 경고: ${provenance.errorSummary}` : ""}`;
  }
  return null;
}
