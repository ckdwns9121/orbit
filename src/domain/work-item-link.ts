export type WorkItemLinkKind = "jira" | "github_pr" | "github_commit";

export interface WorkItemLink {
  id: string;
  workItemId: string;
  kind: WorkItemLinkKind;
  externalId: string | null;
  externalUrl: string | null;
  label: string;
  status: string;
  lastSyncedAt: string | null;
  createdAt: string;
}
