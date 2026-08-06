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
