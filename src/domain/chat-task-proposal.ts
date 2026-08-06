export type ChatTaskProposalStatus = "pending" | "approving" | "created" | "rejected" | "error";

export interface ChatTaskProposal {
  id: string;
  title: string;
  description: string | null;
  status: ChatTaskProposalStatus;
  error?: string;
  workItemId?: string;
}

export interface CreateTaskToolCall {
  callId: string;
  name: "create_task";
  arguments: unknown;
}

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function taskProposalFromToolCall(call: CreateTaskToolCall): ChatTaskProposal | null {
  const input = typeof call.arguments === "object" && call.arguments !== null
    ? call.arguments as Record<string, unknown>
    : {};
  const title = normalizedText(input.title, 160);
  if (!title) return null;
  return {
    id: call.callId,
    title,
    description: normalizedText(input.description, 1_000) || null,
    status: "pending",
  };
}
