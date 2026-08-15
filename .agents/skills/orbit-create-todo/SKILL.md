---
name: orbit-create-todo
description: Create one task in the user's Orbit app through the Orbit MCP server. Use only when the user explicitly asks to add, create, or remember a todo in Orbit.
---

Create exactly one Orbit task from the user's request.

1. If the task is genuinely ambiguous, ask one concise question. Otherwise proceed.
2. Normalize a concise title and infer optional fields only from information the user supplied.
3. Resolve relative deadlines to ISO 8601 with the user's local timezone.
4. Call the `orbit` MCP server's `create_task` tool exactly once. Never edit the Orbit SQLite database directly.
5. Return the created title, status, deadline if present, and task ID.
