import type { WorkItemStatus } from "./work-item";

export interface WorkItemTransition {
  targetId: string;
  targetStatus: WorkItemStatus;
}

export function requiresCheckpoint(
  focusItemId: string | undefined,
  transition: WorkItemTransition,
): boolean {
  if (!focusItemId) return false;

  const isLeavingCurrentFocus = transition.targetId === focusItemId
    && transition.targetStatus !== "focus"
    && transition.targetStatus !== "done";
  const isStartingAnotherFocus = transition.targetId !== focusItemId
    && transition.targetStatus === "focus";

  return isLeavingCurrentFocus || isStartingAnotherFocus;
}
