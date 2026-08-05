export type SessionCompletionState = "active" | "done";

export function taskStatusForSessions(states: SessionCompletionState[]): "todo" | "ai_running" | "done" {
  if (states.length === 0) return "todo";
  return states.every((state) => state === "done") ? "done" : "ai_running";
}
