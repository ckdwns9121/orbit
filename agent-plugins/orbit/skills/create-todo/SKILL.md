---
name: create-todo
description: Create a task in the user's Orbit app from a short natural-language request. Use when the user explicitly asks to add, create, or remember a todo in Orbit.
disable-model-invocation: true
allowed-tools: mcp__orbit__create_task
argument-hint: "<할 일 내용>"
---

Create exactly one Orbit task from `$ARGUMENTS`.

1. If the request is empty or the title is genuinely ambiguous, ask one concise question.
2. Normalize a concise title. Infer optional fields only when the request supports them.
3. Resolve a relative deadline against the current local date and pass an ISO 8601 value with timezone.
4. Call the Orbit MCP `create_task` tool once. Do not write to SQLite or Jira directly.
5. Return the created title, status, deadline if present, and task ID.
