import { getDatabase } from "./database";

export interface WeeklyReviewSnapshot {
  completed: Array<{ workItemId: string; title: string; result: string; decisions: string; risk: string }>;
  ongoing: Array<{ workItemId: string; title: string; status: string }>;
  blocked: Array<{ workItemId: string; title: string; reason: string | null; resumeCondition: string | null }>;
  stale: Array<{ workItemId: string; title: string }>;
  resumeSuccessCount: number;
}

export interface WeeklyReview {
  id: string;
  weekStart: string;
  weekEnd: string;
  version: number;
  snapshot: WeeklyReviewSnapshot;
  partialSources: string[];
  createdAt: string;
}

interface WeeklyReviewRow {
  id: string;
  week_start: string;
  week_end: string;
  version: number;
  snapshot_json: string;
  partial_sources_json: string;
  created_at: string;
}

export function localWeekRange(containing: Date): { start: Date; end: Date } {
  const start = new Date(containing.getFullYear(), containing.getMonth(), containing.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapRow(row: WeeklyReviewRow): WeeklyReview {
  return {
    id: row.id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    version: row.version,
    snapshot: parseJson(row.snapshot_json, {
      completed: [], ongoing: [], blocked: [], stale: [], resumeSuccessCount: 0,
    }),
    partialSources: parseJson(row.partial_sources_json, []),
    createdAt: row.created_at,
  };
}

export async function generateWeeklyReview(input: {
  weekContaining: Date;
  now?: Date;
}): Promise<WeeklyReview> {
  const database = await getDatabase();
  const { start, end } = localWeekRange(input.weekContaining);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const now = input.now ?? new Date();
  const completed = await database.select<WeeklyReviewSnapshot["completed"]>(
    `SELECT c.work_item_id AS workItemId, w.title, c.result_summary AS result,
      c.decisions, c.remaining_risk AS risk
     FROM completion_records c JOIN work_items w ON w.id = c.work_item_id
     WHERE c.completed_at >= $1 AND c.completed_at < $2
     ORDER BY c.completed_at, c.id`,
    [startIso, endIso],
  );
  const ongoing = await database.select<WeeklyReviewSnapshot["ongoing"]>(
    `SELECT id AS workItemId, title, status FROM work_items
     WHERE status NOT IN ('done', 'blocked') ORDER BY status, updated_at, id`,
  );
  const blocked = await database.select<WeeklyReviewSnapshot["blocked"]>(
    `SELECT id AS workItemId, title, blocked_reason AS reason,
      resume_condition AS resumeCondition FROM work_items
     WHERE status = 'blocked' ORDER BY updated_at, id`,
  );
  const staleBefore = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const stale = await database.select<WeeklyReviewSnapshot["stale"]>(
    `SELECT id AS workItemId, title FROM work_items
     WHERE status <> 'done' AND COALESCE(last_focused_at, paused_at, updated_at) < $1
     ORDER BY updated_at, id`,
    [staleBefore],
  );
  const [resume] = await database.select<Array<{ count: number }>>(
    `SELECT COUNT(DISTINCT r.work_item_id) AS count FROM activity_events r
     WHERE r.event_type = 'task_resumed' AND r.occurred_at >= $1 AND r.occurred_at < $2
       AND EXISTS (
         SELECT 1 FROM activity_events p WHERE p.work_item_id = r.work_item_id
           AND p.event_type IN ('checkpoint_updated','next_action_updated','evidence_linked',
             'blocked_resolved','status_advanced','task_completed')
           AND julianday(p.occurred_at) > julianday(r.occurred_at)
           AND julianday(p.occurred_at) <= julianday(r.occurred_at) + 1
       )`,
    [startIso, endIso],
  );
  const partialRows = await database.select<Array<{ source: string; scope_key: string }>>(
    `SELECT source, scope_key FROM source_sync_state
     WHERE status IN ('partial','failed','auth-required','rate-limited','stale')
     ORDER BY source, scope_key`,
  );
  const snapshot: WeeklyReviewSnapshot = {
    completed,
    ongoing,
    blocked,
    stale,
    resumeSuccessCount: resume?.count ?? 0,
  };
  const [versionRow] = await database.select<Array<{ next_version: number }>>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM weekly_reviews
     WHERE week_start = $1 AND week_end = $2`,
    [startIso, endIso],
  );
  const review: WeeklyReview = {
    id: crypto.randomUUID(),
    weekStart: startIso,
    weekEnd: endIso,
    version: versionRow.next_version,
    snapshot,
    partialSources: partialRows.map(({ source, scope_key }) => `${source}:${scope_key}`),
    createdAt: now.toISOString(),
  };
  await database.execute(
    `INSERT INTO weekly_reviews(
      id, week_start, week_end, version, snapshot_json, partial_sources_json, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [review.id, review.weekStart, review.weekEnd, review.version,
      JSON.stringify(review.snapshot), JSON.stringify(review.partialSources), review.createdAt],
  );
  return review;
}

export async function listWeeklyReviews(limit = 20): Promise<WeeklyReview[]> {
  const database = await getDatabase();
  const rows = await database.select<WeeklyReviewRow[]>(
    `SELECT id, week_start, week_end, version, snapshot_json, partial_sources_json, created_at
     FROM weekly_reviews ORDER BY week_start DESC, version DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map(mapRow);
}
