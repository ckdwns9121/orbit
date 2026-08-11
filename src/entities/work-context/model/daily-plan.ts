import type { WorkItem } from "./work-item";

export type DailyPlanState = "planned" | "completed" | "carried" | "skipped";

export interface DailyPlanEntry {
  id: string;
  workItemId: string;
  planDate: string;
  sortOrder: number;
  plannedDurationMinutes: number | null;
  state: DailyPlanState;
  createdAt: string;
  updatedAt: string;
  workItem: WorkItem;
}

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addLocalDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function isDailyPlanActive(state: DailyPlanState) {
  return state === "planned" || state === "completed";
}

export function reorderDailyPlanEntries(
  entries: DailyPlanEntry[],
  sourceId: string,
  targetId: string,
): DailyPlanEntry[] {
  if (sourceId === targetId) return entries;
  const sourceIndex = entries.findIndex((entry) => entry.id === sourceId);
  const targetIndex = entries.findIndex((entry) => entry.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return entries;
  const next = [...entries];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next.map((entry, index) => ({ ...entry, sortOrder: index }));
}

export function reorderDailyPlanIds(ids: string[], fromId: string, toId: string) {
  if (fromId === toId) return ids;
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return ids;

  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function shiftDailyPlanId(ids: string[], id: string, direction: -1 | 1) {
  const index = ids.indexOf(id);
  if (index < 0) return ids;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= ids.length) return ids;

  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  return next;
}
