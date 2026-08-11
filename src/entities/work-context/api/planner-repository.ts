import { addWorkItemToDailyPlan } from "./daily-plan-repository";
import { createWorkItem } from "./work-item-repository";
import { getDatabase } from "./database";
import { addLocalDays } from "../model/daily-plan";
import { parseWeekdays, serializeWeekdays, type PlannerCategory, type PlannerRoutine } from "../model/planner";

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: number;
}

interface RoutineRow {
  id: string;
  title: string;
  category_id: string | null;
  weekdays: string;
  reminder_time: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function toCategory(row: CategoryRow): PlannerCategory {
  return { id: row.id, name: row.name, color: row.color, sortOrder: row.sort_order, isSystem: Boolean(row.is_system) };
}

function toRoutine(row: RoutineRow): PlannerRoutine {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.category_id,
    weekdays: parseWeekdays(row.weekdays),
    reminderTime: row.reminder_time,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPlannerCategories(): Promise<PlannerCategory[]> {
  const database = await getDatabase();
  const rows = await database.select<CategoryRow[]>("SELECT * FROM planner_categories ORDER BY sort_order, created_at, id");
  return rows.map(toCategory);
}

export async function createPlannerCategory(name: string, color: string): Promise<string> {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("카테고리 이름을 입력해주세요.");
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("올바른 카테고리 색상을 선택해주세요.");
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const [{ next_order }] = await database.select<Array<{ next_order: number }>>(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM planner_categories",
  );
  await database.execute(
    "INSERT INTO planner_categories(id, name, color, sort_order, created_at, updated_at) VALUES($1, $2, $3, $4, $5, $5)",
    [id, normalizedName, color, next_order, now],
  );
  return id;
}

export async function deletePlannerCategory(id: string): Promise<void> {
  const database = await getDatabase();
  const [category] = await database.select<Array<{ is_system: number }>>("SELECT is_system FROM planner_categories WHERE id = $1", [id]);
  if (category?.is_system) throw new Error("기본 카테고리는 삭제할 수 없습니다.");
  await database.execute("DELETE FROM planner_categories WHERE id = $1", [id]);
}

export async function listPlannerRoutines(): Promise<PlannerRoutine[]> {
  const database = await getDatabase();
  const rows = await database.select<RoutineRow[]>("SELECT * FROM planner_routines ORDER BY active DESC, created_at DESC");
  return rows.map(toRoutine);
}

export async function createPlannerRoutine(input: {
  title: string;
  categoryId: string | null;
  weekdays: number[];
  reminderTime: string | null;
}): Promise<string> {
  const title = input.title.trim();
  const weekdays = serializeWeekdays(input.weekdays);
  if (!title) throw new Error("루틴 이름을 입력해주세요.");
  if (!weekdays) throw new Error("반복할 요일을 하나 이상 선택해주세요.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO planner_routines(id, title, category_id, weekdays, reminder_time, created_at, updated_at)
     VALUES($1, $2, $3, $4, $5, $6, $6)`,
    [id, title, input.categoryId, weekdays, input.reminderTime || null, now],
  );
  return id;
}

export async function deletePlannerRoutine(id: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("DELETE FROM planner_routines WHERE id = $1", [id]);
}

const routineMaterializationFlights = new Map<string, Promise<number>>();

export function materializePlannerRoutines(startDate: string, endDate: string): Promise<number> {
  const key = `${startDate}:${endDate}`;
  const existing = routineMaterializationFlights.get(key);
  if (existing) return existing;
  const flight = materializePlannerRoutinesOnce(startDate, endDate).finally(() => routineMaterializationFlights.delete(key));
  routineMaterializationFlights.set(key, flight);
  return flight;
}

async function materializePlannerRoutinesOnce(startDate: string, endDate: string): Promise<number> {
  const database = await getDatabase();
  const [routines, occurrences] = await Promise.all([
    listPlannerRoutines(),
    database.select<Array<{ routine_id: string; plan_date: string }>>(
      "SELECT routine_id, plan_date FROM planner_routine_occurrences WHERE routine_id IS NOT NULL AND plan_date BETWEEN $1 AND $2",
      [startDate, endDate],
    ),
  ]);
  const existing = new Set(occurrences.map((row) => `${row.routine_id}:${row.plan_date}`));
  let created = 0;

  for (const routine of routines.filter((item) => item.active)) {
    for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const occurrenceKey = `${routine.id}:${date}`;
      if (!routine.weekdays.includes(weekday) || existing.has(occurrenceKey)) continue;
      const targetAt = routine.reminderTime ? new Date(`${date}T${routine.reminderTime}:00`).toISOString() : null;
      const workItemId = await createWorkItem({
        title: routine.title,
        status: "todo",
        categoryId: routine.categoryId,
        targetAt,
      });
      await addWorkItemToDailyPlan(workItemId, date);
      await database.execute(
        `INSERT INTO planner_routine_occurrences(id, routine_id, plan_date, work_item_id, created_at)
         VALUES($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), routine.id, date, workItemId, new Date().toISOString()],
      );
      existing.add(occurrenceKey);
      created += 1;
    }
  }
  return created;
}
