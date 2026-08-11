export type AiProvider = "claude" | "codex";

export interface DiscoveredAiSession {
  provider: AiProvider;
  sessionId: string;
  title: string;
  cwd: string | null;
  model: string | null;
  firstPrompt: string | null;
  lastPrompt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  modifiedAtMs: number;
  messageCount: number;
}

export interface AiSession extends DiscoveredAiSession {
  customTitle: string | null;
  completionState: "active" | "done";
  acknowledgedAtMs: number;
  linkedWorkItemId: string | null;
}

export function sessionActivity(session: AiSession, now = Date.now()) {
  const isRecentlyActive = now - session.modifiedAtMs < 15 * 60 * 1000;
  const needsAttention = session.modifiedAtMs > session.acknowledgedAtMs;
  return { isRecentlyActive, needsAttention };
}

export function projectName(cwd: string | null): string {
  if (!cwd) return "프로젝트 없음";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

const internalContextPrefixes = [
  "<environment_context>",
  "<permissions instructions>",
  "<collaboration_mode>",
  "<apps_instructions>",
  "<plugins_instructions>",
  "<skills_instructions>",
  "<multi_agent_mode>",
];

export function isInternalSessionText(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase();
  return internalContextPrefixes.some((prefix) => normalized.startsWith(prefix));
}

export function displaySessionTitle(session: AiSession): string {
  return [session.customTitle, session.title, session.firstPrompt, session.lastPrompt]
    .find((value) => value && !isInternalSessionText(value)) || "제목 없는 세션";
}

export function displaySessionPrompt(value: string | null): string | null {
  return value && !isInternalSessionText(value) ? value : null;
}
