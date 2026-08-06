import type { CalendarEvent } from "../domain/calendar-event";
import type { JiraIssueDevelopment } from "../domain/jira-development";
import type { WorkItem } from "../domain/work-item";
import { listCalendarEvents } from "./calendar-event-repository";
import { getDatabase } from "./database";
import { listCachedPullRequests } from "./github-pull-request-repository";
import { listCachedJiraIssues } from "./jira-issue-repository";
import { listWorkItems } from "./work-item-repository";

export type DashboardPeriod = 7 | 30;

export interface DashboardCommit {
  repository: string;
  sha: string;
  message: string;
  url: string;
  authoredAt: string;
}

export interface DashboardActivityDay {
  date: string;
  label: string;
  tasks: number;
  jira: number;
  commits: number;
  total: number;
}

export interface DashboardWin {
  id: string;
  kind: "task" | "jira" | "commit";
  title: string;
  detail: string;
  occurredAt: string;
  url: string | null;
}

export interface DashboardSnapshot {
  period: DashboardPeriod;
  currentTasks: WorkItem[];
  todayEvents: CalendarEvent[];
  completedTasks: number;
  totalCompletedTasks: number;
  completedJira: number;
  totalCompletedJira: number;
  commits: number;
  totalCommits: number;
  openPullRequests: number;
  reviewRequests: number;
  dailyActivity: DashboardActivityDay[];
  recentWins: DashboardWin[];
  workHealth: Array<{ status: string; label: string; count: number }>;
  projectBreakdown: Array<{ label: string; count: number }>;
}

type DevelopmentRow = { payload: string };

export async function loadDashboardSnapshot(
  period: DashboardPeriod = 7,
  now = new Date(),
): Promise<DashboardSnapshot> {
  const today = dayRange(now, 0);
  const range = periodRange(now, period);
  const [tasks, events, pullRequests, developments, jiraIssues] = await Promise.all([
    listWorkItems(),
    listCalendarEvents(today.start, today.end),
    listCachedPullRequests(),
    listDevelopmentPayloads(),
    listCachedJiraIssues(),
  ]);
  const allCommits = uniqueCommits(developments);
  const completedTasks = tasks.filter((task) => task.completedAt && within(task.completedAt, range));
  const completedJira = jiraIssues.filter((issue) => issue.statusCategory === "done" && within(issue.updatedAt, range));
  const periodCommits = allCommits.filter((commit) => within(commit.authoredAt, range));
  const activity = buildActivity(period, range.start, completedTasks, completedJira, periodCommits);
  const recentWins: DashboardWin[] = [
    ...completedTasks.map((task) => ({
      id: `task:${task.id}`,
      kind: "task" as const,
      title: task.title,
      detail: "Orbit Task 완료",
      occurredAt: task.completedAt!,
      url: null,
    })),
    ...completedJira.map((issue) => ({
      id: `jira:${issue.key}`,
      kind: "jira" as const,
      title: issue.summary,
      detail: `${issue.key} · ${issue.projectName}`,
      occurredAt: issue.updatedAt,
      url: issue.url,
    })),
    ...periodCommits.map((commit) => ({
      id: `commit:${commit.repository}:${commit.sha}`,
      kind: "commit" as const,
      title: commit.message,
      detail: `${commit.repository} · ${commit.sha.slice(0, 7)}`,
      occurredAt: commit.authoredAt,
      url: commit.url,
    })),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 7);

  const healthMeta = [
    ["focus", "집중 중"],
    ["ai_running", "AI 작업 중"],
    ["review", "내 확인 필요"],
    ["blocked", "막힘"],
    ["todo", "대기 중"],
  ] as const;
  const projectCounts = new Map<string, number>();
  for (const issue of completedJira) {
    projectCounts.set(issue.projectName, (projectCounts.get(issue.projectName) || 0) + 1);
  }

  return {
    period,
    currentTasks: tasks.filter((task) => task.status !== "done"),
    todayEvents: events,
    completedTasks: completedTasks.length,
    totalCompletedTasks: tasks.filter((task) => task.status === "done").length,
    completedJira: completedJira.length,
    totalCompletedJira: jiraIssues.filter((issue) => issue.statusCategory === "done").length,
    commits: periodCommits.length,
    totalCommits: allCommits.length,
    openPullRequests: pullRequests.filter((pullRequest) => pullRequest.authoredByViewer).length,
    reviewRequests: pullRequests.filter((pullRequest) => pullRequest.reviewRequested).length,
    dailyActivity: activity,
    recentWins,
    workHealth: healthMeta.map(([status, label]) => ({
      status,
      label,
      count: tasks.filter((task) => task.status === status).length,
    })),
    projectBreakdown: [...projectCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
  };
}

export function dayRange(now: Date, offset: number) {
  const start = new Date(now);
  start.setDate(start.getDate() + offset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function periodRange(now: Date, days: DashboardPeriod) {
  const end = dayRange(now, 0).end;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start, end };
}

function uniqueCommits(developments: JiraIssueDevelopment[]): DashboardCommit[] {
  const commits = new Map<string, DashboardCommit>();
  for (const development of developments) {
    for (const commit of development.commits) {
      if (!commit.authoredAt) continue;
      commits.set(`${commit.repository}:${commit.sha}`, { ...commit, authoredAt: commit.authoredAt });
    }
  }
  return [...commits.values()].sort((left, right) => right.authoredAt.localeCompare(left.authoredAt));
}

function buildActivity(
  days: DashboardPeriod,
  start: Date,
  tasks: WorkItem[],
  jiraIssues: Array<{ updatedAt: string }>,
  commits: DashboardCommit[],
): DashboardActivityDay[] {
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    const range = dayRange(day, 0);
    const taskCount = tasks.filter((task) => task.completedAt && within(task.completedAt, range)).length;
    const jiraCount = jiraIssues.filter((issue) => within(issue.updatedAt, range)).length;
    const commitCount = commits.filter((commit) => within(commit.authoredAt, range)).length;
    return {
      date: day.toISOString(),
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      tasks: taskCount,
      jira: jiraCount,
      commits: commitCount,
      total: taskCount + jiraCount + commitCount,
    };
  });
}

function within(value: string, range: { start: Date; end: Date }) {
  const timestamp = new Date(value).getTime();
  return timestamp >= range.start.getTime() && timestamp < range.end.getTime();
}

async function listDevelopmentPayloads(): Promise<JiraIssueDevelopment[]> {
  const database = await getDatabase();
  const rows = await database.select<DevelopmentRow[]>("SELECT payload FROM jira_development_cache ORDER BY synced_at DESC LIMIT 50");
  return rows.flatMap((row) => { try { return [JSON.parse(row.payload) as JiraIssueDevelopment]; } catch { return []; } });
}
