export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: "new" | "indeterminate" | "done" | string;
  priority: string | null;
  projectKey: string;
  projectName: string;
  dueDate: string | null;
  updatedAt: string;
  url: string;
  discoveredAt: string;
}

export interface AssignedJiraIssuesResult {
  issues: Array<Omit<JiraIssue, "discoveredAt">>;
  truncated: boolean;
}

export interface JiraTaskLink {
  issueKey: string;
  workItemId: string;
  workItemTitle: string;
}
