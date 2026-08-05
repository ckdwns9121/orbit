export const workItemStatuses = [
  "inbox",
  "todo",
  "focus",
  "ai_running",
  "review",
  "blocked",
  "done",
] as const;

export type WorkItemStatus = (typeof workItemStatuses)[number];
export type WorkItemPriority = "p1" | "p2" | "p3";
export type WorkItemSource = "local" | "jira" | "github" | "slack" | "calendar";

export interface WorkItem {
  id: string;
  title: string;
  status: WorkItemStatus;
  priority: WorkItemPriority | null;
  source: WorkItemSource;
  externalId: string | null;
  externalUrl: string | null;
  goal: string | null;
  checkpoint: string | null;
  nextAction: string | null;
  doneDefinition: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateWorkItemInput {
  title: string;
  status: WorkItemStatus;
  priority?: WorkItemPriority | null;
  goal?: string;
  nextAction?: string;
  doneDefinition?: string;
}

export const statusMeta: Record<
  WorkItemStatus,
  { label: string; shortLabel: string; order: number }
> = {
  focus: { label: "지금 집중 중", shortLabel: "집중", order: 0 },
  review: { label: "내 확인 필요", shortLabel: "확인", order: 1 },
  ai_running: { label: "AI 작업 중", shortLabel: "AI", order: 2 },
  todo: { label: "할 일", shortLabel: "할 일", order: 3 },
  blocked: { label: "막힘", shortLabel: "막힘", order: 4 },
  inbox: { label: "Inbox", shortLabel: "Inbox", order: 5 },
  done: { label: "완료", shortLabel: "완료", order: 6 },
};
