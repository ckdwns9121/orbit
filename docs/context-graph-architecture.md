# Orbit Context Graph Architecture

## Purpose

Orbit restores the context around a piece of work instead of returning isolated search hits. A Task can be connected to its Jira issue, pull request or commit, Slack discussion, Confluence page, calendar event, and AI work session.

## Storage boundary

Canonical product records remain in their existing SQLite tables. The context graph is a derived index and never owns Task or integration state.

```text
Task / Jira / GitHub / Slack / Confluence / Calendar / AI sessions
                              │
                              ▼
                  canonical SQLite records
                              │
                    deterministic projection
                              │
                              ▼
              versioned property-graph generations
                              │
             text seeds + bounded relation traversal
                              │
                              ▼
                         Orbit Chat
```

The first production store is a local SQLite property-graph projection. This keeps Orbit self-contained and preserves a clean boundary for a later Graphiti, Neo4j, or FalkorDB adapter without making the desktop app depend on a separately operated service.

## Graph model

Node types:

- `task`
- `jira_issue`
- `pull_request`
- `github_commit`
- `slack_message`
- `confluence_page`
- `calendar_event`
- `ai_session`

Important relations:

- `TRACKED_BY`: Task → Jira
- `IMPLEMENTED_BY`: Task → pull request
- `EVIDENCED_BY`: Task → commit
- `DISCUSSED_IN`: Task → Slack message
- `WORKED_ON`: AI session → Task
- `REFERENCES`: a conservative Jira-key inference
- `RELATED_TO`: conservative title-token overlap

Every edge stores its derivation (`explicit`, `inferred`, or `system`), weight, and evidence JSON. Explicit links always outrank inferred links. Missing cache rows do not erase an explicit link; the projection creates a clearly marked synthetic evidence node until the original record is available.

## Rebuild and publication protocol

`@tauri-apps/plugin-sql` does not expose a JavaScript transaction spanning multiple awaited calls. Orbit therefore does not use `BEGIN` and `COMMIT` from TypeScript.

1. Read the canonical source revision and fingerprint.
2. Load source records and build an isolated `building` generation.
3. Recheck the fingerprint after reads and again inside the publish SQL statement.
4. Change the generation to `ready` with one statement.
5. A SQLite trigger validates node and edge counts and atomically moves the singleton current-generation pointer.
6. Readers join through that pointer and can only see a complete `ready` generation.
7. A failed build leaves the previous ready generation visible. Source races are retried, and concurrent rebuild requests share one in-process flight.

Canonical source triggers increment `context_graph_source_state.revision` on inserts, updates, and deletes. This catches local edits that do not naturally change an upstream timestamp.

## Retrieval

Chat retrieval is deterministic and local. It is deliberately not an OpenAI function tool.

1. Normalize Unicode and retain Korean terms and Jira keys.
2. Apply an explicit date or year only when the user supplied one.
3. Rank direct text and identifier matches.
4. Traverse at most two relation hops.
5. Prefer explicit edges and cap the result at 30 nodes.
6. Send labels, timestamps, URLs, relation types, and provenance to the existing answer planner and streaming response.

If graph indexing or retrieval fails, the source status shows an error and Chat continues with its existing Task, Calendar, Jira, GitHub, Slack, Confluence, and completed-work context.

## Privacy and safety

- The graph never stores Keychain credentials.
- Common credential patterns are redacted from indexed text.
- Injected AI-session environment and system context is excluded.
- Published generations are immutable.
- Search values are never interpolated into SQL.
- Inferred edges cannot mutate a Task or an external service.

## Future external graph adapter

The domain graph types, projection, and Chat grounding do not depend on the SQLite schema. If graph volume or multi-device collaboration requires a graph-native engine, keep SQLite canonical and replace only the graph persistence/search facade. A Graphiti adapter should preserve stable source identities, temporal timestamps, provenance, bounded result sizes, and the same failure fallback.
