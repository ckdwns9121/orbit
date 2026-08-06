import type { WorkItemPriority } from "./work-item";

export interface TaskAiFixSuggestion {
  id: string;
  priority: WorkItemPriority;
  targetAt: string;
  reason: string;
}

export interface TaskAiFixPlan {
  summary: string;
  suggestions: TaskAiFixSuggestion[];
}

function isPriority(value: unknown): value is WorkItemPriority {
  return value === "p1" || value === "p2" || value === "p3";
}

export function validateTaskAiFixPlan(
  value: TaskAiFixPlan,
  expectedIds: string[],
  now = new Date(),
): TaskAiFixPlan {
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const suggestions = value.suggestions.filter((suggestion) => {
    if (!expected.has(suggestion.id) || seen.has(suggestion.id) || !isPriority(suggestion.priority)) return false;
    const target = new Date(suggestion.targetAt);
    if (Number.isNaN(target.getTime()) || target.getTime() <= now.getTime()) return false;
    seen.add(suggestion.id);
    return true;
  }).map((suggestion) => ({
    ...suggestion,
    reason: suggestion.reason.trim().slice(0, 240),
    targetAt: new Date(suggestion.targetAt).toISOString(),
  }));

  if (suggestions.length !== expected.size) {
    throw new Error("AI가 일부 Task의 유효한 우선순위 또는 목표 시간을 만들지 못했습니다. 다시 분석해주세요.");
  }
  return { summary: value.summary.trim().slice(0, 500), suggestions };
}
