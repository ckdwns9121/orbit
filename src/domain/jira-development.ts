export interface JiraIssueDevelopment {
  issue: {
    key: string;
    summary: string;
    status: string;
    assignee: string | null;
    updatedAt: string;
    url: string;
  };
  pullRequests: Array<{
    repository: string;
    number: number;
    title: string;
    url: string;
    status: string;
    headRefName: string;
    authorLogin: string | null;
  }>;
  commits: Array<{
    repository: string;
    sha: string;
    message: string;
    url: string;
    authorName: string | null;
    authoredAt: string | null;
  }>;
  warnings: string[];
}
