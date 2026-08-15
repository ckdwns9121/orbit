---
name: my-ticket
description: Show Jira tickets assigned to the user from Orbit's synchronized cache, including linked Orbit tasks. Use when the user asks for their tickets or linked ticket status.
disable-model-invocation: true
allowed-tools: mcp__orbit__list_my_tickets
argument-hint: "[티켓 키 또는 검색어]"
---

Use the Orbit MCP `list_my_tickets` tool to show the user's open Jira tickets.

- If `$ARGUMENTS` contains a ticket key or search phrase, pass it as `query`.
- Never call Jira directly or claim the data was freshly synchronized.
- Show key, summary, Jira status, URL, and linked Orbit task names.
- End with a short note that results reflect Orbit's latest local Jira cache.
