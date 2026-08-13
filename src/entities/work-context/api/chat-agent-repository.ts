import type { ChatAgentApproval, ChatAgentApprovalStatus, ChatAgentRun, ChatAgentRunStatus } from "../model/chat-agent";
import { getDatabase } from "./database";

type RunRow = { id: string; thread_id: string; question: string; model: string; context: string; conversation_json: string; transcript_json: string; iteration: number; tool_count: number; status: ChatAgentRunStatus; response_id: string | null; created_at: string; updated_at: string };
type ApprovalRow = { id: string; run_id: string; message_id: string | null; call_id: string; tool_name: ChatAgentApproval["toolName"]; arguments_json: string; status: ChatAgentApprovalStatus; result_json: string | null; error: string | null; created_at: string; updated_at: string };

const parseJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const toRun = (row: RunRow): ChatAgentRun => ({ id: row.id, threadId: row.thread_id, question: row.question, model: row.model, context: row.context, conversation: parseJson(row.conversation_json, []), transcript: parseJson(row.transcript_json, []), iteration: row.iteration, toolCount: row.tool_count, status: row.status, responseId: row.response_id, createdAt: row.created_at, updatedAt: row.updated_at });
const toApproval = (row: ApprovalRow): ChatAgentApproval => ({ id: row.id, runId: row.run_id, messageId: row.message_id, callId: row.call_id, toolName: row.tool_name, arguments: parseJson(row.arguments_json, {}), status: row.status, result: row.result_json ? parseJson(row.result_json, {}) : null, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at });

export async function createChatAgentRun(input: Pick<ChatAgentRun, "threadId" | "question" | "model" | "context" | "conversation">): Promise<ChatAgentRun> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const run: ChatAgentRun = { id: crypto.randomUUID(), ...input, transcript: [], iteration: 0, toolCount: 0, status: "running", responseId: null, createdAt: now, updatedAt: now };
  await database.execute(`INSERT INTO chat_agent_runs(id,thread_id,question,model,context,conversation_json,transcript_json,iteration,tool_count,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'[]',0,0,'running',$7,$7)`, [run.id, run.threadId, run.question, run.model, run.context, JSON.stringify(run.conversation), now]);
  return run;
}

export async function saveChatAgentRun(run: ChatAgentRun): Promise<void> {
  const database = await getDatabase();
  await database.execute(`UPDATE chat_agent_runs SET transcript_json=$1,iteration=$2,tool_count=$3,status=$4,response_id=$5,updated_at=$6 WHERE id=$7`, [JSON.stringify(run.transcript), run.iteration, run.toolCount, run.status, run.responseId, new Date().toISOString(), run.id]);
}

export async function getChatAgentRun(id: string): Promise<ChatAgentRun | null> {
  const database = await getDatabase();
  const rows = await database.select<RunRow[]>("SELECT * FROM chat_agent_runs WHERE id=$1 LIMIT 1", [id]);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function createAgentApprovals(runId: string, calls: Array<{ callId: string; name: ChatAgentApproval["toolName"]; arguments: unknown }>): Promise<ChatAgentApproval[]> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const approvals = calls.map<ChatAgentApproval>((call) => ({ id: crypto.randomUUID(), runId, messageId: null, callId: call.callId, toolName: call.name, arguments: typeof call.arguments === "object" && call.arguments !== null ? call.arguments as Record<string, unknown> : {}, status: "pending", result: null, error: null, createdAt: now, updatedAt: now }));
  for (const item of approvals) await database.execute(`INSERT INTO chat_agent_approvals(id,run_id,call_id,tool_name,arguments_json,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$6)`, [item.id, item.runId, item.callId, item.toolName, JSON.stringify(item.arguments), now]);
  return approvals;
}

export async function attachAgentApprovalsToMessage(runId: string, messageId: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("UPDATE chat_agent_approvals SET message_id=$1,updated_at=$2 WHERE run_id=$3", [messageId, new Date().toISOString(), runId]);
}

export async function listThreadAgentApprovals(threadId: string): Promise<ChatAgentApproval[]> {
  const database = await getDatabase();
  const rows = await database.select<ApprovalRow[]>(`SELECT a.* FROM chat_agent_approvals a JOIN chat_agent_runs r ON r.id=a.run_id WHERE r.thread_id=$1 ORDER BY a.created_at`, [threadId]);
  return rows.map(toApproval);
}

export async function listRunAgentApprovals(runId: string): Promise<ChatAgentApproval[]> {
  const database = await getDatabase();
  const rows = await database.select<ApprovalRow[]>("SELECT * FROM chat_agent_approvals WHERE run_id=$1 ORDER BY created_at", [runId]);
  return rows.map(toApproval);
}

export async function updateAgentApproval(id: string, status: ChatAgentApprovalStatus, result: Record<string, unknown> | null = null, error: string | null = null): Promise<void> {
  const database = await getDatabase();
  await database.execute("UPDATE chat_agent_approvals SET status=$1,result_json=$2,error=$3,updated_at=$4 WHERE id=$5", [status, result ? JSON.stringify(result) : null, error, new Date().toISOString(), id]);
}
