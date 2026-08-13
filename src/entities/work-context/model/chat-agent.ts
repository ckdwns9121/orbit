export type ChatAgentRunStatus = "running" | "awaiting_approval" | "completed" | "cancelled" | "failed";
export type ChatAgentApprovalStatus = "pending" | "executing" | "approved" | "rejected" | "failed";
export type ChatAgentMutationTool = "create_task" | "update_task" | "add_task_to_planner";

export interface ChatAgentRun {
  id: string; threadId: string; question: string; model: string; context: string;
  conversation: Array<Record<string, unknown>>; transcript: Array<Record<string, unknown>>;
  iteration: number; toolCount: number; status: ChatAgentRunStatus; responseId: string | null;
  createdAt: string; updatedAt: string;
}

export interface ChatAgentApproval {
  id: string; runId: string; messageId: string | null; callId: string; toolName: ChatAgentMutationTool;
  arguments: Record<string, unknown>; status: ChatAgentApprovalStatus; result: Record<string, unknown> | null;
  error: string | null; createdAt: string; updatedAt: string;
}

export interface ChatAgentStepView { id: string; label: string; state: "running" | "complete" | "waiting" | "error"; }

export function approvalTitle(approval: ChatAgentApproval): string {
  if (approval.toolName === "create_task") return String(approval.arguments.title || "새 할 일");
  if (approval.toolName === "update_task") return String(approval.arguments.title || `Task ${approval.arguments.task_id || ""}`);
  return `${approval.arguments.plan_date || "선택한 날짜"} Planner에 추가`;
}

export function approvalPrompt(tool: ChatAgentMutationTool): string {
  if (tool === "create_task") return "이 할 일을 생성할까요?";
  if (tool === "update_task") return "이 Task 변경을 적용할까요?";
  return "이 Task를 Planner에 추가할까요?";
}
