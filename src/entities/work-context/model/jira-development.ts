export interface JiraIssueDevelopment {
  issue: {
    key: string;
    summary: string;
    status: string;
    assignee: string | null;
    updatedAt: string;
    url: string;
  };
  branches: Array<{
    repository: string;
    name: string;
    url: string;
  }>;
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
  builds: Array<{
    repository: string;
    id: number;
    name: string;
    url: string;
    status: string;
    conclusion: string | null;
    branch: string;
    createdAt: string;
  }>;
  warnings: string[];
}

export interface CachedJiraIssueDevelopment {
  development: JiraIssueDevelopment;
  syncedAt: string;
}

export const JIRA_DEVELOPMENT_CACHE_TTL_MS = 30 * 60 * 1_000;

export function shouldRefreshJiraDevelopment(
  cached: CachedJiraIssueDevelopment | null,
  now = Date.now(),
): boolean {
  if (!cached) return true;
  const syncedAt = new Date(cached.syncedAt).getTime();
  return Number.isNaN(syncedAt) || now - syncedAt >= JIRA_DEVELOPMENT_CACHE_TTL_MS;
}
