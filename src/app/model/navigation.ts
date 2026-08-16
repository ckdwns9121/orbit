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

export const primarySections: readonly PrimarySection[] = [
  "dashboard",
  "tasks",
  "calendar",
  "chat",
  "graph",
  "sessions",
  "jira",
  "pull_requests",
  "settings",
];

export const sectionTitle: Record<PrimarySection, string> = {
  dashboard: "Planner",
  tasks: "Task",
  calendar: "Calendar",
  chat: "Chat",
  graph: "Graph",
  sessions: "Workspace",
  jira: "Jira Tickets",
  pull_requests: "Pull Requests",
  settings: "Settings",
};

export function isPrimarySection(value: unknown): value is PrimarySection {
  return typeof value === "string" && primarySections.includes(value as PrimarySection);
}

export function restoreOpenSections(value: string | null): PrimarySection[] {
  if (!value) return ["dashboard"];
  try {
    const stored = JSON.parse(value);
    if (!Array.isArray(stored)) return ["dashboard"];
    const unique = stored.filter(isPrimarySection).filter((section, index, sections) =>
      sections.indexOf(section) === index,
    );
    return unique.length > 0 ? unique : ["dashboard"];
  } catch {
    return ["dashboard"];
  }
}


export function formatToday() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}
