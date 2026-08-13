import { describe, expect, test } from "bun:test";
import { briefingSummary, mergeBriefingEvidence, type DailyBriefingItem } from "./daily-briefing";

const item = (id: string, title: string): DailyBriefingItem => ({ id, title, detail: "", source: "task", evidence: [] });

describe("daily briefing report", () => {
  test("summarizes factual report items without inventing work", () => {
    expect(briefingSummary("오늘은", [item("1", "회의"), item("2", "배포"), item("3", "리뷰")], "없음"))
      .toBe("오늘은 회의, 배포 외 1건입니다.");
    expect(briefingSummary("오늘은", [], "예정된 일이 없습니다.")).toBe("예정된 일이 없습니다.");
  });

  test("deduplicates the same reference URL", () => {
    expect(mergeBriefingEvidence([
      { source: "jira", label: "A", detail: "first", url: "https://jira/A" },
      { source: "jira", label: "A duplicate", detail: "second", url: "https://jira/A" },
    ])).toHaveLength(1);
  });
});
