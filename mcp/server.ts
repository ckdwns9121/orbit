import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { OrbitRepository } from "./orbit-repository";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  goal: z.string().nullable(),
  nextAction: z.string().nullable(),
  targetAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ticketSchema = z.object({
  key: z.string(),
  summary: z.string(),
  status: z.string(),
  statusCategory: z.string(),
  priority: z.string().nullable(),
  projectKey: z.string(),
  dueDate: z.string().nullable(),
  updatedAt: z.string(),
  url: z.string(),
  linkedTasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.string() })),
});

export function createOrbitMcpServer(): McpServer {
  const server = new McpServer(
    { name: "orbit", version: "0.1.0" },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions:
        "Orbit is the user's local work system. Read tools use Orbit's synchronized local cache. create_task writes a new local Orbit task and must only be called when the user clearly asks to create one. Never claim that Jira was refreshed or changed by these tools.",
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Create Orbit task",
      description: "Create a new local task in Orbit. Use only after the user clearly requests task creation.",
      inputSchema: z.object({
        title: z.string().min(1).max(300).describe("Concise task title"),
        goal: z.string().max(4000).optional().describe("Why this task matters or the desired outcome"),
        nextAction: z.string().max(2000).optional().describe("Concrete next action"),
        doneDefinition: z.string().max(4000).optional().describe("Observable completion criteria"),
        priority: z.enum(["p1", "p2", "p3"]).optional(),
        targetAt: z.string().optional().describe("ISO 8601 deadline with timezone"),
        status: z.enum(["inbox", "todo"]).default("todo"),
      }),
      outputSchema: z.object({ task: taskSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => withRepository((repository) => {
      const task = repository.createTask(input);
      return successResult({ task }, `Orbit에 할 일을 만들었습니다: ${task.title} (${task.status})`);
    }),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Orbit tasks",
      description: "List tasks already stored in Orbit, optionally filtering by status or text.",
      inputSchema: z.object({
        status: z.enum(["open", "all", "inbox", "todo", "focus", "ai_running", "review", "blocked", "done"]).default("open"),
        query: z.string().max(300).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      outputSchema: z.object({ tasks: z.array(taskSchema), count: z.number() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => withRepository((repository) => {
      const tasks = repository.listTasks(input);
      return successResult({ tasks, count: tasks.length }, formatTasks(tasks));
    }),
  );

  server.registerTool(
    "list_my_tickets",
    {
      title: "List my Jira tickets",
      description: "List Jira tickets assigned to the user from Orbit's synchronized cache, including linked Orbit tasks.",
      inputSchema: z.object({
        state: z.enum(["open", "done", "all"]).default("open"),
        query: z.string().max(300).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      outputSchema: z.object({ tickets: z.array(ticketSchema), count: z.number(), source: z.literal("orbit-cache") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => withRepository((repository) => {
      const tickets = repository.listMyTickets(input);
      return successResult(
        { tickets, count: tickets.length, source: "orbit-cache" as const },
        formatTickets(tickets),
      );
    }),
  );

  server.registerPrompt(
    "create-todo",
    {
      title: "Create an Orbit todo",
      description: "Turn a short request into a structured Orbit task and create it.",
      argsSchema: z.object({ request: z.string().describe("The task the user wants to create") }),
    },
    ({ request }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Create one Orbit task from this request: ${request}\nNormalize the title, infer only clearly supported fields, then call orbit create_task. Return the created task succinctly.`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "my-ticket",
    {
      title: "Show my Jira tickets",
      description: "Show Jira tickets assigned to the user and their linked Orbit tasks.",
      argsSchema: z.object({ query: z.string().optional().describe("Optional ticket key or search text") }),
    },
    ({ query }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Call Orbit list_my_tickets for open tickets${query ? ` matching ${query}` : ""}. Explain that results come from Orbit's last synchronized Jira cache and show linked Orbit tasks.`,
        },
      }],
    }),
  );

  return server;
}

function withRepository<T>(callback: (repository: OrbitRepository) => T): T {
  const repository = new OrbitRepository();
  try {
    return callback(repository);
  } finally {
    repository.close();
  }
}

function successResult<T extends Record<string, unknown>>(structuredContent: T, text: string) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function formatTasks(tasks: ReturnType<OrbitRepository["listTasks"]>): string {
  if (tasks.length === 0) return "조건에 맞는 Orbit 할 일이 없습니다.";
  return tasks.map((task) => `- [${task.status}] ${task.title}${task.priority ? ` · ${task.priority}` : ""}`).join("\n");
}

function formatTickets(tickets: ReturnType<OrbitRepository["listMyTickets"]>): string {
  if (tickets.length === 0) return "Orbit의 Jira 캐시에 조건에 맞는 티켓이 없습니다.";
  return tickets.map((ticket) => {
    const links = ticket.linkedTasks.length > 0
      ? ` · Orbit 작업: ${ticket.linkedTasks.map((task) => task.title).join(", ")}`
      : "";
    return `- ${ticket.key} · ${ticket.summary} · ${ticket.status}${links}\n  ${ticket.url}`;
  }).join("\n");
}

if (import.meta.main) {
  serveStdio(createOrbitMcpServer, {
    onerror: (error) => console.error(`[orbit-mcp] ${error.message}`),
  });
}
