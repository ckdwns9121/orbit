import { describe, expect, test } from "bun:test";
import type { GitHubPullRequest } from "./github-pull-request";
import { pullRequestWaitLabel, reviewRequestedPullRequests } from "./github-pull-request";

function pullRequest(number: number, reviewRequested: boolean, updatedAt: string): GitHubPullRequest {
  return {
    repository: "orbit/web", repoPath: "/tmp/orbit", number, title: `PR ${number}`,
    url: `https://github.com/orbit/web/pull/${number}`, headRefName: `feature/${number}`,
    baseRefName: "main", isDraft: false, updatedAt, authorLogin: "reviewee",
    sessionMatchCount: 0, authoredByViewer: false, reviewRequested, discoveredAt: updatedAt,
  };
}

describe("Planner 리뷰 요청 PR", () => {
  test("내 리뷰 요청만 오래 기다린 순서로 최대 세 건 보여준다", () => {
    const result = reviewRequestedPullRequests([
      pullRequest(3, true, "2026-08-18T03:00:00Z"),
      pullRequest(1, true, "2026-08-16T03:00:00Z"),
      pullRequest(4, true, "2026-08-19T03:00:00Z"),
      pullRequest(2, false, "2026-08-15T03:00:00Z"),
      pullRequest(5, true, "2026-08-17T03:00:00Z"),
    ]);
    expect(result.map(({ number }) => number)).toEqual([1, 5, 3]);
  });

  test("리뷰 대기 시간을 사람이 읽기 쉬운 단위로 표시한다", () => {
    const now = new Date("2026-08-19T06:00:00Z");
    expect(pullRequestWaitLabel("2026-08-19T05:40:00Z", now)).toBe("방금 요청");
    expect(pullRequestWaitLabel("2026-08-19T01:00:00Z", now)).toBe("5시간 대기");
    expect(pullRequestWaitLabel("2026-08-17T05:00:00Z", now)).toBe("2일 대기");
  });
});
