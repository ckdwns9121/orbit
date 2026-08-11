import type { SourceSyncState, SyncSource } from "../../../../entities/work-context/model/work-continuity";
import { syncLocalAiSessions } from "../../../../entities/work-context/api/ai-session-repository";
import { syncGoogleCalendar } from "../../../../entities/work-context/api/google-calendar-repository";
import { refreshPullRequestsWithScope } from "../../../../entities/work-context/api/github-pull-request-repository";
import { refreshAssignedJiraIssues } from "../../../../entities/work-context/api/jira-issue-repository";
import { searchSlackMessages } from "../../../../entities/work-context/api/slack-message-repository";
import { searchConfluencePages } from "../../../../entities/work-context/api/confluence-page-repository";
import { getDatabase } from "../../../../entities/work-context/api/database";
import { getAppSettings } from "../../../../entities/work-context/api/settings-repository";
import { getSourceSyncState, runScopedSourceRefresh } from "../../../../entities/work-context/api/source-sync-repository";
import { normalizeSourceScope, sourceDefinitions } from "../../../../entities/work-context/model/source-capability";

export interface ConnectedSourceRefreshRequest {
  source: SyncSource;
  scopeKey?: string | null;
  force?: boolean;
}

function requiredQueryScope(source: "slack" | "confluence", scopeKey?: string | null) {
  return normalizeSourceScope(source, scopeKey).scopeKey;
}

async function existingState(source: SyncSource, scopeKey: string) {
  const state = await getSourceSyncState(source, scopeKey);
  if (!state) throw new Error(`${source} 동기화 상태를 저장하지 못했습니다.`);
  return state;
}

export async function refreshConnectedSource(
  request: ConnectedSourceRefreshRequest,
): Promise<SourceSyncState> {
  const force = request.force ?? true;
  switch (request.source) {
    case "jira":
      await refreshAssignedJiraIssues({ force });
      return existingState("jira", "global");
    case "github": {
      const refreshed = await refreshPullRequestsWithScope({ force });
      return existingState("github", refreshed.scopeKey);
    }
    case "slack": {
      const scopeKey = requiredQueryScope("slack", request.scopeKey);
      await searchSlackMessages(scopeKey, { force });
      return existingState("slack", scopeKey);
    }
    case "confluence": {
      const scopeKey = requiredQueryScope("confluence", request.scopeKey);
      await searchConfluencePages(scopeKey, { force });
      return existingState("confluence", scopeKey);
    }
    case "ai": {
      const result = await runScopedSourceRefresh({
        source: "ai",
        scopeKey: "local",
        ttlMs: sourceDefinitions.ai.ttlMs,
        force,
        refresh: async () => {
          const sessions = await syncLocalAiSessions();
          return { data: sessions, itemCount: sessions.length };
        },
      });
      return result.state;
    }
    case "calendar": {
      const settings = await getAppSettings();
      if (!settings.google_client_id) throw new Error("Settings에서 Google OAuth Client ID를 입력해주세요.");
      const result = await runScopedSourceRefresh({
        source: "calendar",
        scopeKey: "global",
        ttlMs: sourceDefinitions.calendar.ttlMs,
        force,
        refresh: async () => {
          await syncGoogleCalendar(settings.google_client_id!);
          const database = await getDatabase();
          const rows = await database.select<Array<{ count: number }>>(
            "SELECT COUNT(*) AS count FROM calendar_events WHERE source = 'google'",
          );
          return { data: null, itemCount: rows[0]?.count ?? 0 };
        },
      });
      return result.state;
    }
  }
}
