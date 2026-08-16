---
name: create-todo
description: Create one or multiple tasks in the user's Orbit app from natural-language requests or explicit task lists. Use when the user explicitly asks to add, create, or remember one or more todos in Orbit.
disable-model-invocation: true
allowed-tools: mcp__orbit__create_task
argument-hint: "<할 일 내용>"
---

Create Orbit tasks from `$ARGUMENTS`.

1. If the request is empty, ask for the task. Split only clearly enumerated items: commas, semicolons, numbered or bulleted lines, or separate lines.
2. If item boundaries are genuinely ambiguous, ask one concise question. Otherwise preserve the user's order.
3. Normalize a concise title for each item. Infer optional fields only from information attached to that item.
4. Resolve relative deadlines against the current local date and pass ISO 8601 values with timezone.
5. Call the Orbit MCP `create_task` tool exactly once per item. Do not write to SQLite or Jira directly.
6. Do not retry a failed creation automatically. Stop and report partial success plus the failed item.
7. Return every created title, status, deadline if present, and task ID.
