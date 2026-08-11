import { describe, expect, test } from "bun:test";
import type { CompletedWorkSearchResult } from "./completion-repository";
import { asksAboutCompletedWork, buildCompletedWorkGrounding } from "./chat-ai-repository";

const completedWork: CompletedWorkSearchResult = {
  id: "completion-1",
  workItemId: "work-1",
  workItemTitle: "결제 재시도 안정화",
  workItemStatus: "done",
  resultSummary: "중복 결제를 막고 재시도 요청을 멱등하게 처리했다.",
  decisions: "요청 ID를 멱등 키로 사용하기로 결정했다.",
  remainingRisk: "외부 PG 지연 시 상태 확인이 늦어질 수 있다.",
  retrospective: "운영 로그를 먼저 연결했으면 원인 확인이 빨랐을 것이다.",
  jiraProjectKey: "PAY",
  evidence: [
    {
      source: "github_pr",
      sourceId: "orbit#42",
      label: "PR #42 재시도 멱등성",
      url: "https://github.com/example/orbit/pull/42",
      excerpt: "멱등 키 저장과 충돌 응답을 추가함",
    },
    {
      source: "jira",
      sourceId: "PAY-17",
      label: "PAY-17",
      url: "https://example.atlassian.net/browse/PAY-17",
    },
  ],
  provenance: "user",
  state: "active",
  baseWorkItemRevision: 4,
  supersededAt: null,
  completedAt: "2026-08-01T09:30:00.000Z",
  createdAt: "2026-08-01T09:30:00.000Z",
};

describe("completed work Chat grounding", () => {
  test("adds only stored completion claims and evidence links for a completed-work question", async () => {
    const calls: unknown[] = [];
    const context = await buildCompletedWorkGrounding(
      "완료한 결제 작업의 결정과 리스크 알려줘",
      async (filters) => {
        calls.push(filters);
        return [completedWork];
      },
    );

    expect(calls).toEqual([{ state: "active", limit: 50 }]);
    expect(context).toContain("[Completed Work — 저장 기록 근거]");
    expect(context).toContain(completedWork.workItemTitle);
    expect(context).toContain(completedWork.resultSummary);
    expect(context).toContain(completedWork.decisions);
    expect(context).toContain(completedWork.remainingRisk);
    expect(context).toContain(completedWork.retrospective);
    expect(context).toContain("[PR #42 재시도 멱등성](https://github.com/example/orbit/pull/42)");
    expect(context).toContain("[PAY-17](https://example.atlassian.net/browse/PAY-17)");
    expect(context).toContain("아래에 없는 사실은 추가하지 마세요");
  });

  test("returns an explicit grounded no-result context instead of allowing invented claims", async () => {
    const context = await buildCompletedWorkGrounding(
      "이전에 완료한 온콜 작업 찾아줘",
      async () => [],
    );

    expect(context).toContain("검색 결과: 저장된 완료 작업이 없습니다.");
    expect(context).toContain("추론하거나 만들어내지 마세요");
    expect(context).not.toContain("완료 작업을 찾았습니다");
  });

  test("does not query completion history for an unrelated live-context question", async () => {
    let searched = false;
    const context = await buildCompletedWorkGrounding("오늘 일정 뭐야?", async () => {
      searched = true;
      return [completedWork];
    });

    expect(asksAboutCompletedWork("오늘 일정 뭐야?")).toBeFalse();
    expect(searched).toBeFalse();
    expect(context).toBe("");
  });

  test("marks a lookup failure as unavailable instead of treating it as an empty success", async () => {
    const context = await buildCompletedWorkGrounding("과거 작업 회고 찾아줘", async () => {
      throw new Error("database unavailable");
    });

    expect(context).toContain("검색 실패: database unavailable");
    expect(context).toContain("완료 기록을 확인할 수 없으므로");
  });
});
