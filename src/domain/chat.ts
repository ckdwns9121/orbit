export type ChatRole = "user" | "assistant";

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  responseId: string | null;
  createdAt: string;
}
