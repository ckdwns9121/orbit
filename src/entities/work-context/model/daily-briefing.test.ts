import { describe, expect, test } from "bun:test";
import { briefingPriorityForScore, mergeBriefingEvidence } from "./daily-briefing";

describe("daily briefing", () => {
  test("maps evidence strength to a suggested priority", () => {
    expect(briefingPriorityForScore(88)).toBe("p1");
    expect(briefingPriorityForScore(62)).toBe("p2");
    expect(briefingPriorityForScore(31)).toBe("p3");
  });

  test("deduplicates the same source URL", () => {
    const evidence = [
      { source: "jira" as const, label: "A", detail: "one", url: "https://jira/A" },
      { source: "jira" as const, label: "A duplicate", detail: "two", url: "https://jira/A" },
      { source: "slack" as const, label: "B", detail: "three" },
    ];
    expect(mergeBriefingEvidence(evidence)).toHaveLength(2);
  });
});
