import { describe, expect, test } from "bun:test";
import { briefingSummary, dailyBriefingToMarkdown, mergeBriefingEvidence, type DailyBriefingItem } from "./daily-briefing";

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

  test("creates a copyable Markdown report with reference links", () => {
    const markdown = dailyBriefingToMarkdown({
      generatedAt: "2026-08-13T01:00:00.000Z",
      yesterday: { summary: "어제 작업했습니다.", items: [item("1", "로그인 수정")] },
      today: { summary: "오늘 배포합니다.", items: [] },
      attention: { summary: "리뷰가 필요합니다.", items: [] },
      references: [{ source: "jira", label: "CGKR-1", detail: "로그인 티켓", url: "https://jira/CGKR-1" }],
      sources: [], notices: [],
    });
    expect(markdown).toContain("# 오늘의 업무 브리핑");
    expect(markdown).toContain("## 어제 한 일");
    expect(markdown).toContain("[CGKR-1](https://jira/CGKR-1)");
  });
});
