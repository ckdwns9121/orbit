import type { DailyPlanEntry, DailyPlanState, DailyPriority } from "../model/daily-plan";
import { isDailyPlanActive, nextDailyPriorityRank } from "../model/daily-plan";
import { listWorkItems } from "./work-item-repository";
import { getDatabase } from "./database";

interface DailyPlanRow {
  id: string;
  work_item_id: string;
  plan_date: string;
  sort_order: number;
  planned_duration_minutes: number | null;
  state: DailyPlanState;
  created_at: string;
  updated_at: string;
}

interface DailyPriorityRow {
  id: string;
  plan_date: string;
  work_item_id: string;
  rank: number;
  created_at: string;
  updated_at: string;
}

export const DAILY_PRIORITY_LIMIT = 3;

export async function listDailyPriorities(planDate: string): Promise<DailyPriority[]> {
  const database = await getDatabase();
  const [rows, workItems] = await Promise.all([
    database.select<DailyPriorityRow[]>(
      "SELECT * FROM daily_priorities WHERE plan_date = $1 ORDER BY rank, created_at",
      [planDate],
    ),
    listWorkItems(),
  ]);
  const byId = new Map(workItems.map((item) => [item.id, item]));
  return rows.flatMap((row) => {
    const workItem = byId.get(row.work_item_id);
    return workItem ? [{
      id: row.id,
      planDate: row.plan_date,
      workItemId: row.work_item_id,
      rank: row.rank,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      workItem,
    }] : [];
  });
}

export async function addDailyPriority(planDate: string, workItemId: string): Promise<void> {
  const database = await getDatabase();
  const existing = await database.select<Array<{ id: string }>>(
    "SELECT id FROM daily_priorities WHERE plan_date = $1 AND work_item_id = $2 LIMIT 1",
    [planDate, workItemId],
  );
  if (existing.length) return;
  const occupied = await database.select<Array<{ rank: number }>>(
    "SELECT rank FROM daily_priorities WHERE plan_date = $1 ORDER BY rank",
    [planDate],
  );
  if (occupied.length >= DAILY_PRIORITY_LIMIT) throw new Error("오늘의 핵심은 최대 3개까지 선택할 수 있습니다.");
  const nextRank = nextDailyPriorityRank(occupied.map((row) => row.rank));
  if (!nextRank) throw new Error("오늘의 핵심 순위를 정하지 못했습니다.");
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO daily_priorities(id, plan_date, work_item_id, rank, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [crypto.randomUUID(), planDate, workItemId, nextRank, now],
  );
}

export async function removeDailyPriority(id: string): Promise<void> {
  const database = await getDatabase();
  const rows = await database.select<Array<{ plan_date: string }>>(
    "SELECT plan_date FROM daily_priorities WHERE id = $1 LIMIT 1",
    [id],
  );
  await database.execute("DELETE FROM daily_priorities WHERE id = $1", [id]);
  const planDate = rows[0]?.plan_date;
  if (!planDate) return;
  const remaining = await database.select<Array<{ id: string }>>(
    "SELECT id FROM daily_priorities WHERE plan_date = $1 ORDER BY rank, created_at",
    [planDate],
  );
  if (remaining.length) await reorderDailyPriorities(planDate, remaining.map((row) => row.id));
}

export async function replaceDailyPriority(id: string, workItemId: string): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    "UPDATE daily_priorities SET work_item_id = $1, updated_at = $2 WHERE id = $3",
    [workItemId, new Date().toISOString(), id],
  );
}

export async function reorderDailyPriorities(planDate: string, orderedIds: string[]): Promise<void> {
  const normalized = orderedIds.filter(Boolean);
  if (new Set(normalized).size !== normalized.length || normalized.length > DAILY_PRIORITY_LIMIT) {
    throw new Error("핵심 작업 순서가 올바르지 않습니다.");
  }
  const database = await getDatabase();
  const rows = await database.select<Array<{ id: string }>>(
    "SELECT id FROM daily_priorities WHERE plan_date = $1",
    [planDate],
  );
  if (rows.length !== normalized.length || rows.some((row) => !normalized.includes(row.id))) {
    throw new Error("현재 보이는 핵심 작업 전체를 기준으로 다시 정렬해주세요.");
  }
  const cases = normalized.map((_, index) => `WHEN $${index + 1} THEN ${index + 1}`).join(" ");
  const placeholders = normalized.map((_, index) => `$${index + 1}`).join(", ");
  const updatedAtIndex = normalized.length + 1;
  const planDateIndex = normalized.length + 2;
  await database.execute(
    `UPDATE daily_priorities
     SET rank = CASE id ${cases} ELSE rank END, updated_at = $${updatedAtIndex}
     WHERE plan_date = $${planDateIndex} AND id IN (${placeholders})`,
    [...normalized, new Date().toISOString(), planDate],
  );
}

export async function listDailyPlan(planDate: string): Promise<DailyPlanEntry[]> {
  return (await listDailyPlanRange(planDate, planDate));
}

export async function listDailyPlanRange(startDate: string, endDate: string): Promise<DailyPlanEntry[]> {
  const database = await getDatabase();
  const [rows, workItems] = await Promise.all([
    database.select<DailyPlanRow[]>(
      `SELECT * FROM daily_plan_entries
       WHERE plan_date BETWEEN $1 AND $2 AND state IN ('planned', 'completed')
       ORDER BY plan_date, sort_order, created_at`,
      [startDate, endDate],
    ),
    listWorkItems(),
  ]);
  const byId = new Map(workItems.map((item) => [item.id, item]));
  return rows.flatMap((row) => {
    const workItem = byId.get(row.work_item_id);
    return workItem ? [{
      id: row.id,
      workItemId: row.work_item_id,
      planDate: row.plan_date,
      sortOrder: row.sort_order,
      plannedDurationMinutes: row.planned_duration_minutes,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      workItem,
    }] : [];
  });
}

export async function addWorkItemToDailyPlan(workItemId: string, planDate: string) {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const [{ next_order }] = await database.select<Array<{ next_order: number }>>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
     FROM daily_plan_entries
     WHERE plan_date = $1 AND state IN ('planned', 'completed')`,
    [planDate],
  );
  await database.execute(
    `INSERT INTO daily_plan_entries (id, work_item_id, plan_date, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT(work_item_id, plan_date) DO UPDATE SET state = 'planned', updated_at = excluded.updated_at`,
    [crypto.randomUUID(), workItemId, planDate, next_order, now],
  );
}

export async function setDailyPlanState(id: string, state: DailyPlanState) {
  const database = await getDatabase();
  await database.execute("UPDATE daily_plan_entries SET state = $1, updated_at = $2 WHERE id = $3", [state, new Date().toISOString(), id]);
}

export async function reorderDailyPlanEntries(planDate: string, orderedIds: string[]) {
  const normalized = orderedIds.filter(Boolean);
  if (normalized.length < 2) return;
  if (new Set(normalized).size !== normalized.length) throw new Error("중복된 일일 계획 항목은 정렬할 수 없습니다.");

  const database = await getDatabase();
  const rows = await database.select<Array<{ id: string; state: DailyPlanState }>>(
    "SELECT id, state FROM daily_plan_entries WHERE plan_date = $1",
    [planDate],
  );
  const activeIds = rows.filter((row) => isDailyPlanActive(row.state)).map((row) => row.id);
  if (activeIds.length !== normalized.length || activeIds.some((id) => !normalized.includes(id))) {
    throw new Error("현재 보이는 Today 항목 전체를 기준으로 다시 정렬해주세요.");
  }

  const cases = normalized.map((_, index) => `WHEN $${index + 1} THEN ${index}`).join(" ");
  const placeholders = normalized.map((_, index) => `$${index + 1}`).join(", ");
  const updatedAtIndex = normalized.length + 1;
  const planDateIndex = normalized.length + 2;

  await database.execute(
    `UPDATE daily_plan_entries
     SET sort_order = CASE id ${cases} ELSE sort_order END,
         updated_at = $${updatedAtIndex}
     WHERE plan_date = $${planDateIndex}
       AND state IN ('planned', 'completed')
       AND id IN (${placeholders})`,
    [...normalized, new Date().toISOString(), planDate],
  );
}

export async function carryDailyPlanEntry(entry: DailyPlanEntry, targetDate: string) {
  await addWorkItemToDailyPlan(entry.workItemId, targetDate);
  await setDailyPlanState(entry.id, "carried");
}
