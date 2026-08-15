---
name: orbit-my-ticket
description: List Jira tickets assigned to the user from Orbit's synchronized local cache and show their linked Orbit tasks. Use when the user asks for their Jira tickets or ticket links.
---

Call the `orbit` MCP server's `list_my_tickets` tool.

- Default to open tickets.
- Pass a ticket key or search phrase from the user's request as `query`.
- Show key, summary, Jira status, URL, and linked Orbit task names.
- Clearly state that results reflect Orbit's latest synchronized Jira cache; do not claim Jira was refreshed.
