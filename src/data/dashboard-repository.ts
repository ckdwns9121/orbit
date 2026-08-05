import type { CalendarEvent } from "../domain/calendar-event";
import type { GitHubPullRequest } from "../domain/github-pull-request";
import type { JiraIssueDevelopment } from "../domain/jira-development";
import type { WorkItem } from "../domain/work-item";
import { listCalendarEvents } from "./calendar-event-repository";
import { getDatabase } from "./database";
import { listCachedPullRequests } from "./github-pull-request-repository";
import { listWorkItems } from "./work-item-repository";

export interface DashboardCommit {
  repository: string;
  sha: string;
  message: string;
  url: string;
  authoredAt: string;
}

export interface DashboardSnapshot {
  currentTasks: WorkItem[];
  todayCompleted: WorkItem[];
  todayEvents: CalendarEvent[];
  yesterdayCompleted: WorkItem[];
  todayPullRequests: GitHubPullRequest[];
  todayCommits: DashboardCommit[];
}

type DevelopmentRow = { payload: string };

export async function loadDashboardSnapshot(now = new Date()): Promise<DashboardSnapshot> {
  const today = dayRange(now, 0);
  const yesterday = dayRange(now, -1);
  const [tasks, events, pullRequests, developments] = await Promise.all([
    listWorkItems(),
    listCalendarEvents(today.start, today.end),
    listCachedPullRequests(),
    listDevelopmentPayloads(),
  ]);
  const todayCommits = new Map<string, DashboardCommit>();
  for (const development of developments) {
    for (const commit of development.commits) {
      if (!commit.authoredAt || !within(commit.authoredAt, today)) continue;
      todayCommits.set(`${commit.repository}:${commit.sha}`, { ...commit, authoredAt: commit.authoredAt });
    }
  }
  return {
    currentTasks: tasks.filter((task) => task.status !== "done").slice(0, 8),
    todayCompleted: tasks.filter((task) => task.completedAt && within(task.completedAt, today)),
    todayEvents: events,
    yesterdayCompleted: tasks.filter((task) => task.completedAt && within(task.completedAt, yesterday)),
    todayPullRequests: pullRequests.filter((pr) => within(pr.updatedAt, today)),
    todayCommits: [...todayCommits.values()].sort((a, b) => b.authoredAt.localeCompare(a.authoredAt)),
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

function within(value: string, range: { start: Date; end: Date }) {
  const time = new Date(value).getTime();
  return time >= range.start.getTime() && time < range.end.getTime();
}

async function listDevelopmentPayloads(): Promise<JiraIssueDevelopment[]> {
  const database = await getDatabase();
  const rows = await database.select<DevelopmentRow[]>("SELECT payload FROM jira_development_cache ORDER BY synced_at DESC LIMIT 50");
  return rows.flatMap((row) => { try { return [JSON.parse(row.payload) as JiraIssueDevelopment]; } catch { return []; } });
}
