import type { WorkItem } from "./work-item";

export const taskSortModes = ["manual", "newest", "oldest"] as const;
export type TaskSortMode = (typeof taskSortModes)[number];

export function isTaskSortMode(value: string | null): value is TaskSortMode {
  return taskSortModes.includes(value as TaskSortMode);
}

export function sortWorkItems(items: WorkItem[], mode: TaskSortMode): WorkItem[] {
  return [...items].sort((left, right) => {
    if (mode === "manual") return left.position - right.position || right.createdAt.localeCompare(left.createdAt);
    const direction = mode === "newest" ? -1 : 1;
    return direction * left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  });
}

export function reorderWorkItemIds(
  ids: string[],
  draggedId: string,
  targetId: string,
  placeAfter: boolean,
): string[] {
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) return ids;
  const next = ids.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedId);
  return next;
}
