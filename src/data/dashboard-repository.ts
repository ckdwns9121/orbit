import type { CalendarEvent } from "../domain/calendar-event";
import type { GitHubPullRequest } from "../domain/github-pull-request";
import type { WorkItem } from "../domain/work-item";
import { listCalendarEvents } from "./calendar-event-repository";
import { listCachedPullRequests } from "./github-pull-request-repository";
import { listWorkItems } from "./work-item-repository";

export type DashboardPeriod = 7 | 30;

export interface DashboardSnapshot {
  todayTasks: WorkItem[];
  yesterdayTasks: WorkItem[];
  openPullRequests: GitHubPullRequest[];
  reviewRequests: GitHubPullRequest[];
  todayEvents: CalendarEvent[];
}

const activeTodayStatuses = new Set<WorkItem["status"]>(["focus", "ai_running", "review"]);

export async function loadDashboardSnapshot(now = new Date()): Promise<DashboardSnapshot> {
  const today = dayRange(now, 0);
  const [tasks, events, pullRequests] = await Promise.all([
    listWorkItems(),
    listCalendarEvents(today.start, today.end),
    listCachedPullRequests(),
  ]);
  const { todayTasks, yesterdayTasks } = dashboardTaskBuckets(tasks, now);

  return {
    todayTasks,
    yesterdayTasks,
    openPullRequests: pullRequests.filter((pullRequest) => pullRequest.authoredByViewer),
    reviewRequests: pullRequests.filter((pullRequest) => pullRequest.reviewRequested),
    todayEvents: [...events].sort((left, right) => left.startAt.localeCompare(right.startAt)),
  };
}

export function dashboardTaskBuckets(tasks: WorkItem[], now: Date) {
  const today = dayRange(now, 0);
  const yesterday = dayRange(now, -1);
  const todayTasks = tasks
    .filter((task) => task.status !== "done" && (
      activeTodayStatuses.has(task.status)
      || Boolean(task.targetAt && within(task.targetAt, today))
    ))
    .sort(compareTodayTasks);
  const yesterdayTasks = tasks
    .filter((task) => Boolean(task.completedAt && within(task.completedAt, yesterday)))
    .sort((left, right) => right.completedAt!.localeCompare(left.completedAt!));
  return { todayTasks, yesterdayTasks };
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

function compareTodayTasks(left: WorkItem, right: WorkItem) {
  if (left.targetAt && right.targetAt) return left.targetAt.localeCompare(right.targetAt);
  if (left.targetAt) return -1;
  if (right.targetAt) return 1;
  return left.position - right.position;
}

function within(value: string, range: { start: Date; end: Date }) {
  const timestamp = new Date(value).getTime();
  return timestamp >= range.start.getTime() && timestamp < range.end.getTime();
}
