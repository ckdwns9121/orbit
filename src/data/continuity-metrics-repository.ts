import type { WorkItem } from "../domain/work-item";
import { qualifyingProgressEventTypes } from "../domain/work-continuity";
import { getDatabase } from "./database";
import { listWorkItems } from "./work-item-repository";

export interface ResumeBriefing {
  continueItems: WorkItem[];
  blockedReviewItems: WorkItem[];
  forgottenItems: WorkItem[];
}

export interface ContinuityMetrics {
  periodStart: string;
  periodEnd: string;
  distinctResumedTasks: number;
  distinctResumeSuccessTasks: number;
  checkpointSaveRate: number;
  resumeSuccessRate24h: number;
  abandonedOpenRatio7d: number;
}

export async function listResumeBriefing(options: {
  now?: Date;
  forgottenAfterMs?: number;
  limitPerSection?: number;
} = {}): Promise<ResumeBriefing> {
  const now = options.now ?? new Date();
  const forgottenBefore = new Date(now.getTime() - (options.forgottenAfterMs ?? 72 * 60 * 60_000));
  const limit = Math.max(1, options.limitPerSection ?? 6);
  const items = await listWorkItems();
  const open = items.filter((item) => item.status !== "done");
  const continueItems = open
    .filter((item) => item.status === "focus" || Boolean(item.checkpoint || item.nextAction))
    .sort((left, right) => Date.parse(right.lastFocusedAt ?? right.pausedAt ?? right.updatedAt)
      - Date.parse(left.lastFocusedAt ?? left.pausedAt ?? left.updatedAt))
    .slice(0, limit);
  const continueIds = new Set(continueItems.map(({ id }) => id));
  const blockedReviewItems = open
    .filter((item) => item.status === "blocked"
      && (!item.nextReviewAt || Date.parse(item.nextReviewAt) <= now.getTime()))
    .sort((left, right) => Date.parse(left.nextReviewAt ?? left.updatedAt)
      - Date.parse(right.nextReviewAt ?? right.updatedAt))
    .slice(0, limit);
  const visibleIds = new Set([...continueIds, ...blockedReviewItems.map(({ id }) => id)]);
  const forgottenItems = open
    .filter((item) => !visibleIds.has(item.id)
      && ["review", "ai_running", "blocked"].includes(item.status)
      && Date.parse(item.updatedAt) <= forgottenBefore.getTime())
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .slice(0, limit);
  return { continueItems, blockedReviewItems, forgottenItems };
}

export async function calculateContinuityMetrics(input: {
  start: Date;
  end: Date;
  now?: Date;
}): Promise<ContinuityMetrics> {
  const database = await getDatabase();
  const start = input.start.toISOString();
  const end = input.end.toISOString();
  const now = input.now ?? new Date();
  const progressTypes = [...qualifyingProgressEventTypes];
  const progressPlaceholders = progressTypes.map((_, index) => `$${index + 3}`).join(",");
  const [resume] = await database.select<Array<{
    resumed: number;
    successful: number;
  }>>(
    `SELECT
       COUNT(DISTINCT r.work_item_id) AS resumed,
       COUNT(DISTINCT CASE WHEN EXISTS (
         SELECT 1 FROM activity_events p
         WHERE p.work_item_id = r.work_item_id
           AND p.event_type IN (${progressPlaceholders})
           AND julianday(p.occurred_at) > julianday(r.occurred_at)
           AND julianday(p.occurred_at) <= julianday(r.occurred_at) + 1
       ) THEN r.work_item_id END) AS successful
     FROM activity_events r
     WHERE r.event_type = 'task_resumed' AND r.occurred_at >= $1 AND r.occurred_at < $2`,
    [start, end, ...progressTypes],
  );
  const [checkpoint] = await database.select<Array<{ requested: number; saved: number }>>(
    `SELECT
       SUM(CASE WHEN event_type = 'pause_requested' THEN 1 ELSE 0 END) AS requested,
       SUM(CASE WHEN event_type = 'pause_saved' THEN 1 ELSE 0 END) AS saved
     FROM activity_events WHERE occurred_at >= $1 AND occurred_at < $2`,
    [start, end],
  );
  const abandonedBefore = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const [open] = await database.select<Array<{ total: number; abandoned: number }>>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(last_focused_at, paused_at, updated_at) < $1 THEN 1 ELSE 0 END) AS abandoned
     FROM work_items WHERE status <> 'done'`,
    [abandonedBefore],
  );
  const resumed = resume?.resumed ?? 0;
  const successful = resume?.successful ?? 0;
  const requested = checkpoint?.requested ?? 0;
  const saved = checkpoint?.saved ?? 0;
  const totalOpen = open?.total ?? 0;
  const abandoned = open?.abandoned ?? 0;
  return {
    periodStart: start,
    periodEnd: end,
    distinctResumedTasks: resumed,
    distinctResumeSuccessTasks: successful,
    checkpointSaveRate: requested > 0 ? saved / requested : 0,
    resumeSuccessRate24h: resumed > 0 ? successful / resumed : 0,
    abandonedOpenRatio7d: totalOpen > 0 ? abandoned / totalOpen : 0,
  };
}
