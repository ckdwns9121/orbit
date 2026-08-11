export type PrimarySection =
  | "dashboard"
  | "tasks"
  | "calendar"
  | "chat"
  | "graph"
  | "sessions"
  | "jira"
  | "pull_requests"
  | "settings";

export const sectionTitle: Record<PrimarySection, string> = {
  dashboard: "Today",
  tasks: "Task",
  calendar: "Calendar",
  chat: "Chat",
  graph: "Graph",
  sessions: "Workspace",
  jira: "Jira Tickets",
  pull_requests: "Pull Requests",
  settings: "Settings",
};

export function formatToday() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}
