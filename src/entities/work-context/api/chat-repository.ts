import type { ChatMessage, ChatRole, ChatThread } from "../model/chat";
import { getDatabase } from "./database";

type ThreadRow = { id: string; title: string; created_at: string; updated_at: string };
type MessageRow = { id: string; thread_id: string; role: ChatRole; content: string; response_id: string | null; created_at: string };

export async function listChatThreads(): Promise<ChatThread[]> {
  const database = await getDatabase();
  const rows = await database.select<ThreadRow[]>("SELECT id, title, created_at, updated_at FROM chat_threads ORDER BY updated_at DESC");
  return rows.map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export async function createChatThread(firstQuestion = "새 대화"): Promise<ChatThread> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const thread = { id: crypto.randomUUID(), title: makeThreadTitle(firstQuestion), createdAt: now, updatedAt: now };
  await database.execute("INSERT INTO chat_threads (id, title, created_at, updated_at) VALUES ($1, $2, $3, $3)", [thread.id, thread.title, now]);
  return thread;
}

export async function listChatMessages(threadId: string): Promise<ChatMessage[]> {
  const database = await getDatabase();
  const rows = await database.select<MessageRow[]>(
    "SELECT id, thread_id, role, content, response_id, created_at FROM chat_messages WHERE thread_id = $1 ORDER BY created_at ASC, id ASC",
    [threadId],
  );
  return rows.map((row) => ({ id: row.id, threadId: row.thread_id, role: row.role, content: row.content, responseId: row.response_id, createdAt: row.created_at }));
}

export async function appendChatMessage(threadId: string, role: ChatRole, content: string, responseId: string | null = null): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.execute(
    "INSERT INTO chat_messages (id, thread_id, role, content, response_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [crypto.randomUUID(), threadId, role, content.trim(), responseId, now],
  );
  await database.execute("UPDATE chat_threads SET updated_at = $1 WHERE id = $2", [now, threadId]);
}

export async function deleteChatThread(threadId: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("DELETE FROM chat_messages WHERE thread_id = $1", [threadId]);
  await database.execute("DELETE FROM chat_threads WHERE id = $1", [threadId]);
}

export function makeThreadTitle(question: string) {
  const title = question.trim().replace(/\s+/g, " ");
  return title.length > 32 ? `${title.slice(0, 32)}…` : title || "새 대화";
}
