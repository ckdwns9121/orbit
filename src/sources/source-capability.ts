export type SourceKind = "jira" | "github" | "slack" | "calendar" | "confluence" | "ai" | "jira-development";

export type SourceCapability = "feed" | "local-scan" | "query-cache";

export interface SourceDefinition {
  capability: SourceCapability;
  ttlMs: number;
}

export const sourceDefinitions: Record<SourceKind, SourceDefinition> = {
  jira: { capability: "feed", ttlMs: 15 * 60_000 },
  github: { capability: "local-scan", ttlMs: 15 * 60_000 },
  slack: { capability: "query-cache", ttlMs: 10 * 60_000 },
  calendar: { capability: "feed", ttlMs: 15 * 60_000 },
  confluence: { capability: "query-cache", ttlMs: 10 * 60_000 },
  ai: { capability: "local-scan", ttlMs: 5 * 60_000 },
  "jira-development": { capability: "query-cache", ttlMs: 30 * 60_000 },
};

export interface SourceScope {
  source: SourceKind;
  scopeKey: string;
}

export function normalizeSourceScope(source: SourceKind, rawScopeKey?: string | null): SourceScope {
  const definition = sourceDefinitions[source];
  const scopeKey = rawScopeKey?.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 500) ?? "";
  if (definition.capability === "feed") return { source, scopeKey: "global" };
  if (!scopeKey) {
    throw new Error(`${source} ${definition.capability} refresh requires an explicit scopeKey.`);
  }
  return { source, scopeKey };
}

export function sourceScopeIdentity(scope: SourceScope) {
  return `${scope.source}\u001f${scope.scopeKey}`;
}

export function stableScopeKey(values: string[]) {
  const canonical = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort()
    .join("\u001f");
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function isSourceStale(
  source: SourceKind,
  lastSuccessAt: string | null,
  nowMs = Date.now(),
) {
  if (!lastSuccessAt) return true;
  const lastSuccessMs = Date.parse(lastSuccessAt);
  return !Number.isFinite(lastSuccessMs) || nowMs - lastSuccessMs >= sourceDefinitions[source].ttlMs;
}

export function createScopedSingleFlight() {
  const active = new Map<string, Promise<unknown>>();

  return function runScoped<T>(scope: SourceScope, operation: () => Promise<T>): Promise<T> {
    const identity = sourceScopeIdentity(scope);
    const existing = active.get(identity) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = operation().finally(() => {
      if (active.get(identity) === pending) active.delete(identity);
    });
    active.set(identity, pending);
    return pending;
  };
}
