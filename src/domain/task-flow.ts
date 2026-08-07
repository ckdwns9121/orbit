export type SessionCompletionState = "active" | "done";

export type SessionStatusSuggestion = "ai_running" | "review";

/**
 * AI sessions are observations, not Task-state authorities. Consumers may use
 * this result to create a reviewable suggestion, but must never apply it
 * directly to a WorkItem.
 */
export function taskStatusSuggestionForSessions(
  states: SessionCompletionState[],
): SessionStatusSuggestion | null {
  if (states.length === 0) return null;
  return states.every((state) => state === "done") ? "review" : "ai_running";
}
