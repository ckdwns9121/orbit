export interface GitHubPullRequest {
  repository: string;
  repoPath: string;
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  updatedAt: string;
  authorLogin: string | null;
  sessionMatchCount: number;
  authoredByViewer: boolean;
  reviewRequested: boolean;
  discoveredAt: string;
}

export interface DiscoveredGitHubPullRequest extends Omit<GitHubPullRequest, "discoveredAt"> {}

export interface PullRequestScanResult {
  pullRequests: DiscoveredGitHubPullRequest[];
  repositoriesScanned: number;
  repositoriesSucceeded: number;
  warnings: string[];
}

export interface PullRequestTaskLink {
  url: string;
  workItemId: string;
  workItemTitle: string;
}

export function reviewRequestedPullRequests(
  pullRequests: GitHubPullRequest[],
  limit = 3,
): GitHubPullRequest[] {
  return pullRequests
    .filter((pullRequest) => pullRequest.reviewRequested)
    .sort((left, right) => new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime())
    .slice(0, Math.max(0, limit));
}

export function pullRequestWaitLabel(updatedAt: string, now = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - new Date(updatedAt).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "방금 요청";
  if (hours < 24) return `${hours}시간 대기`;
  return `${Math.floor(hours / 24)}일 대기`;
}
