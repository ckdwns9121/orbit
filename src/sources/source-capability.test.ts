import { describe, expect, test } from "bun:test";
import {
  createScopedSingleFlight,
  isSourceStale,
  normalizeSourceScope,
  stableScopeKey,
  sourceDefinitions,
} from "./source-capability";

describe("source capability and scope", () => {
  test("finite feeds use one global scope", () => {
    expect(normalizeSourceScope("jira", "ignored query")).toEqual({ source: "jira", scopeKey: "global" });
    expect(normalizeSourceScope("calendar")).toEqual({ source: "calendar", scopeKey: "global" });
  });

  test("query caches and local scans require isolated scopes", () => {
    expect(normalizeSourceScope("slack", "  Incident   Review ")).toEqual({
      source: "slack",
      scopeKey: "incident review",
    });
    expect(() => normalizeSourceScope("confluence", " ")).toThrow("explicit scopeKey");
    expect(() => normalizeSourceScope("github")).toThrow("explicit scopeKey");
  });

  test("uses the documented source TTLs", () => {
    expect(sourceDefinitions.ai.ttlMs).toBe(5 * 60_000);
    expect(sourceDefinitions.slack.ttlMs).toBe(10 * 60_000);
    expect(sourceDefinitions.jira.ttlMs).toBe(15 * 60_000);
    expect(sourceDefinitions["jira-development"].ttlMs).toBe(30 * 60_000);
    expect(isSourceStale("slack", "2026-08-06T00:00:00.000Z", Date.parse("2026-08-06T00:09:59.999Z"))).toBe(false);
    expect(isSourceStale("slack", "2026-08-06T00:00:00.000Z", Date.parse("2026-08-06T00:10:00.000Z"))).toBe(true);
  });

  test("local scan scope hash is stable across path order and duplicates", () => {
    expect(stableScopeKey(["/repo/b", "/repo/a", "/repo/a"])).toBe(stableScopeKey(["/repo/a", "/repo/b"]));
    expect(stableScopeKey(["/repo/a"])).not.toBe(stableScopeKey(["/repo/b"]));
  });
});

test("identical source and scope refreshes share one operation", async () => {
  const run = createScopedSingleFlight();
  const scope = normalizeSourceScope("slack", "CGKR-2492");
  let calls = 0;
  let release!: (value: string) => void;
  const first = run(scope, () => {
    calls += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  });
  const second = run(scope, async () => {
    calls += 1;
    return "unexpected";
  });
  expect(first).toBe(second);
  expect(calls).toBe(1);
  release("ok");
  expect(await second).toBe("ok");
});

test("different query scopes stay isolated", async () => {
  const run = createScopedSingleFlight();
  let calls = 0;
  const [first, second] = await Promise.all([
    run(normalizeSourceScope("slack", "alpha"), async () => { calls += 1; return "alpha"; }),
    run(normalizeSourceScope("slack", "beta"), async () => { calls += 1; return "beta"; }),
  ]);
  expect([first, second]).toEqual(["alpha", "beta"]);
  expect(calls).toBe(2);
});

test("a rejected flight is removed so a manual retry can run", async () => {
  const run = createScopedSingleFlight();
  const scope = normalizeSourceScope("confluence", "runbook");
  let calls = 0;
  await expect(run(scope, async () => {
    calls += 1;
    throw new Error("offline");
  })).rejects.toThrow("offline");
  expect(await run(scope, async () => { calls += 1; return "recovered"; })).toBe("recovered");
  expect(calls).toBe(2);
});
