import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlarmClock,
  Calendar,
  Check,
  CheckSquare,
  CircleCheck,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GripVertical,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plug,
  Plus,
  Settings,
  Sparkles,
  Ticket,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import "./App.scss";
import {
  createWorkItem,
  deleteWorkItem,
  listWorkItems,
  reorderWorkItems,
  updateWorkItemTargetAt,
  updateWorkItemTitle,
} from "./data/work-item-repository";
import {
  linkAiSession,
  listAiSessions,
  listWorkItemSessionProgress,
  setAiSessionCompletion,
  type WorkItemSessionProgress,
} from "./data/ai-session-repository";
import {
  createWorkItemLink,
  deleteWorkItemLink,
  extractJiraKey,
  listWorkItemLinks,
} from "./data/work-item-link-repository";
import {
  getCachedJiraIssueDevelopment,
  syncJiraIssueDevelopment,
} from "./data/jira-development-repository";
import {
  listCachedJiraIssues,
  listJiraTaskLinks,
  refreshAssignedJiraIssues,
} from "./data/jira-issue-repository";
import { autoConnectTaskAiSessions } from "./data/context-discovery-repository";
import {
  statusMeta,
  workItemStatuses,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemStatus,
} from "./domain/work-item";
import { displaySessionTitle, projectName, type AiSession } from "./domain/ai-session";
import {
  shouldRefreshJiraDevelopment,
  type JiraIssueDevelopment,
} from "./domain/jira-development";
import type { WorkItemLink } from "./domain/work-item-link";
import type { JiraIssue, JiraTaskLink } from "./domain/jira-issue";
import { taskStatusSuggestionForSessions } from "./domain/task-flow";
import { isTaskSortMode, reorderWorkItemIds, sortWorkItems, type TaskSortMode } from "./domain/work-item-sort";
import { taskBoardLaneForStatus, taskBoardLanes, type TaskBoardLane } from "./domain/task-board";
import CalendarPage from "./calendar/CalendarPage";
import SettingsPage from "./settings/SettingsPage";
import WorkspacePage from "./workspace/WorkspacePage";
import PullRequestsPage from "./pull-requests/PullRequestsPage";
import JiraTicketsPage from "./jira/JiraTicketsPage";
import TaskContextDiscoveryModal from "./context/TaskContextDiscoveryModal";
import ChatPage from "./chat/ChatPage";
import DashboardPage from "./dashboard/DashboardPage";
import GraphPage from "./graph/GraphPage";
import ServiceIcon, { serviceIconForProvider } from "./components/ServiceIcon";
import SearchCombobox, { type SearchComboboxOption } from "./components/SearchCombobox";
import QuickPanel from "./quick-panel/QuickPanel";
import { getAppSettings } from "./data/settings-repository";
import { DEFAULT_QUICK_PANEL_SHORTCUT, displayShortcut, matchesShortcutEvent, shortcutSettingsFromStored } from "./domain/shortcuts";
import { getRegisteredShortcuts, setShortcutActions, syncGlobalShortcuts } from "./shortcuts/global-shortcuts";
import { requestTaskReminderPermission } from "./notifications/task-reminders";
import TaskAiFix from "./tasks/TaskAiFix";
import {
  applyStatusSuggestion,
  createStatusSuggestion,
  getFocusSlot,
  ignoreStatusSuggestion,
  listPendingStatusSuggestions,
  recordActivityEvent,
  switchFocusedWorkItem,
  transitionWorkItem,
} from "./data/work-continuity-repository";
import type { StatusSuggestion } from "./domain/work-continuity";
import { InterruptionDialog, type InterruptionValues } from "./continuity/ContinuityDialogs";
import "./continuity/ContinuityDialogs.scss";
import { completeWorkItem, type CompletionEvidence } from "./data/completion-repository";
import { CompletionSheet } from "./continuity/ContinuityDialogs";
import { listSourceSyncStates } from "./data/source-sync-repository";
import type { SourceSyncState } from "./domain/work-continuity";
import { saveSlackMessageToInbox } from "./data/inbox-repository";
import { prepareEnabledCheckpointDraft, recordAutomationApproval } from "./data/automation-repository";
import { recoverDurableJiraOutbox } from "./sources/jira-outbox-recovery";

type PrimarySection = "dashboard" | "tasks" | "calendar" | "chat" | "graph" | "sessions" | "jira" | "pull_requests" | "settings";

const TASK_SORT_STORAGE_KEY = "orbit.task-sort";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "orbit.sidebar-collapsed";

const taskBoardLaneMeta: Record<TaskBoardLane, { label: string; description: string }> = {
  todo: { label: "할 일", description: "시작을 기다리는 모든 작업" },
  ai_running: { label: "진행 중", description: "현재 실행하고 있는 작업" },
  done: { label: "완료", description: "결과와 근거를 남긴 작업" },
};

function formatToday() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

function formatWorkItemCreatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatWorkItemTargetAt(value: string) {
  const target = new Date(value);
  const label = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(target);
  return `${target.getTime() <= Date.now() ? "목표 지남" : "목표"} ${label}`;
}

function App() {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [discoveryTask, setDiscoveryTask] = useState<{ id: string; title: string; description: string } | null>(null);
  const [pendingTransition, setPendingTransition] = useState<{ targetId: string; targetStatus: WorkItemStatus; openContextAfter?: boolean; suggestionId?: string } | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<WorkItem | null>(null);
  const [statusSuggestions, setStatusSuggestions] = useState<StatusSuggestion[]>([]);
  const [sourceSyncStates, setSourceSyncStates] = useState<SourceSyncState[]>([]);
  const [completionEvidence, setCompletionEvidence] = useState<CompletionEvidence[]>([]);
  const [interruptionEvidence, setInterruptionEvidence] = useState<Array<{ label: string; url?: string }>>([]);
  const [interruptionDraft, setInterruptionDraft] = useState<{ checkpoint?: string; nextAction?: string }>({});
  const [activeSection, setActiveSection] = useState<PrimarySection>("dashboard");
  const [contextItem, setContextItem] = useState<WorkItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<WorkItem | null>(null);
  const [sessionProgress, setSessionProgress] = useState<Record<string, WorkItemSessionProgress>>({});
  const [isQuickPanelOpen, setIsQuickPanelOpen] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true",
  );
  const [taskSortMode, setTaskSortMode] = useState<TaskSortMode>(() => {
    const stored = window.localStorage.getItem(TASK_SORT_STORAGE_KEY);
    return isTaskSortMode(stored) ? stored : "manual";
  });

  const groupedItems = useMemo(() => {
    return Object.fromEntries(
      workItemStatuses.map((status) => [
        status,
        items.filter((item) => item.status === status),
      ]),
    ) as Record<WorkItemStatus, WorkItem[]>;
  }, [items]);

  const focusItem = groupedItems.focus[0];
  const quickPanelItems = items.filter((item) => item.status !== "done" && item.status !== "inbox").slice(0, 12);

  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeSection]);

  useEffect(() => {
    if (!focusItem) return;
    setActiveSection("tasks");
    setIsQuickPanelOpen(false);
    setIsComposerOpen(false);
    setDiscoveryTask(null);
    setDeleteItem(null);
    setContextItem((current) => current?.id === focusItem.id ? current : null);
  }, [focusItem?.id]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [nextItems, nextProgress, nextSuggestions, nextSyncStates] = await Promise.all([
        listWorkItems(),
        listWorkItemSessionProgress(),
        listPendingStatusSuggestions(),
        listSourceSyncStates(),
      ]);
      setItems(nextItems);
      setSessionProgress(nextProgress);
      setStatusSuggestions(nextSuggestions);
      setSourceSyncStates(nextSyncStates);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void recoverDurableJiraOutbox()
      .then(async (report) => {
        if (report.reconciled > 0) await refresh();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [refresh]);

  useEffect(() => {
    setShortcutActions(focusItem ? {
      openQuickPanel: () => undefined,
      openChat: () => undefined,
    } : {
      openQuickPanel: () => setIsQuickPanelOpen(true),
      openChat: () => { setIsQuickPanelOpen(false); setActiveSection("chat"); },
    });
  }, [focusItem?.id]);

  useEffect(() => {
    void getAppSettings()
      .then((stored) => syncGlobalShortcuts(shortcutSettingsFromStored(stored)))
      .catch((cause) => setShortcutError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    if (!pendingCompletion) { setCompletionEvidence([]); return; }
    let active = true;
    void Promise.all([listWorkItemLinks(pendingCompletion.id), listAiSessions()]).then(([links, sessions]) => {
      if (!active) return;
      setCompletionEvidence([
        ...links.map((link) => ({
          source: link.kind,
          sourceId: link.externalId || link.id,
          label: link.label,
          url: link.externalUrl,
          excerpt: link.kind === "slack" ? link.label : null,
        } satisfies CompletionEvidence)),
        ...sessions.filter((session) => session.linkedWorkItemId === pendingCompletion.id).map((session) => ({
          source: "ai" as const,
          sourceId: `${session.provider}:${session.sessionId}`,
          label: displaySessionTitle(session),
          url: null,
        })),
      ]);
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { active = false; };
  }, [pendingCompletion]);

  useEffect(() => {
    if (!pendingTransition || !focusItem) { setInterruptionEvidence([]); setInterruptionDraft({}); return; }
    let active = true;
    void Promise.all([listWorkItemLinks(focusItem.id), listAiSessions()]).then(([links, sessions]) => {
      if (!active) return;
      const linkedSessions = sessions.filter((session) => session.linkedWorkItemId === focusItem.id);
      const evidence = [
        ...linkedSessions.slice(0, 2).map((session) => ({ label: `AI · ${displaySessionTitle(session)}` })),
        ...links.slice(0, 4).map((link) => ({ label: `${link.kind.toUpperCase()} · ${link.label}`, ...(link.externalUrl ? { url: link.externalUrl } : {}) })),
      ];
      setInterruptionEvidence(evidence);
      const draft = {
        checkpoint: focusItem.checkpoint || (evidence.length ? `${focusItem.title}의 연결 근거 ${evidence.length}개를 확인한 지점입니다.` : undefined),
        nextAction: focusItem.nextAction || (evidence[0] ? `${evidence[0].label}부터 열어 남은 작업을 확인합니다.` : undefined),
      };
      setInterruptionDraft(draft);
      if (draft.checkpoint && draft.nextAction) {
        void prepareEnabledCheckpointDraft({
          normalizedSourceIdentity: "checkpoint:evidence-draft",
          workItemId: focusItem.id,
          expectedRevision: focusItem.revision,
          checkpoint: draft.checkpoint,
          nextAction: draft.nextAction,
          evidence: evidence.map((entry) => ({ source: "linked-context", ...entry })),
        }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
      }
    }).catch(() => { if (active) { setInterruptionEvidence([]); setInterruptionDraft({}); } });
    return () => { active = false; };
  }, [pendingTransition, focusItem]);

  useEffect(() => {
    if (!contextItem) return;
    void recordActivityEvent({ eventType: "context_opened", workItemId: contextItem.id, source: "app" });
  }, [contextItem?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (focusItem) return;
      const shortcuts = getRegisteredShortcuts();
      if (!shortcuts) return;
      if (matchesShortcutEvent(event, shortcuts.quickPanel)) {
        event.preventDefault();
        setIsQuickPanelOpen(true);
      } else if (matchesShortcutEvent(event, shortcuts.chat)) {
        event.preventDefault();
        setIsQuickPanelOpen(false);
        setActiveSection("chat");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusItem?.id]);

  async function commitMove(id: string, status: WorkItemStatus): Promise<boolean> {
    try {
      setError(null);
      const item = items.find((candidate) => candidate.id === id);
      if (!item || item.status === status) return true;
      if (status === "done") {
        setPendingCompletion(item);
        return false;
      }
      if (status === "focus") {
        const slot = await getFocusSlot();
        const current = slot.workItemId ? items.find((candidate) => candidate.id === slot.workItemId) : null;
        if (current && current.id !== item.id) {
          void recordActivityEvent({ eventType: "pause_requested", workItemId: current.id, source: "app" });
          setPendingTransition({ targetId: id, targetStatus: status });
          return false;
        }
        await switchFocusedWorkItem({
          currentWorkItemId: null,
          requestedWorkItemId: id,
          expectedSlotRevision: slot.revision,
          expectedCurrentRevision: null,
          expectedRequestedRevision: item.revision,
        });
      } else {
        await transitionWorkItem({
          workItemId: id,
          expectedRevision: item.revision,
          targetStatus: status as Exclude<WorkItemStatus, "focus" | "done">,
        });
      }
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
      return false;
    }
  }

  async function handleMove(id: string, status: WorkItemStatus) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.status === status) return;

    const transition = { targetId: id, targetStatus: status };
    const isLeavingFocus = item.status === "focus" && status !== "focus" && status !== "done";
    const isReplacingFocus = status === "focus" && Boolean(focusItem && focusItem.id !== id);
    if (isLeavingFocus || isReplacingFocus) {
      if (focusItem) void recordActivityEvent({ eventType: "pause_requested", workItemId: focusItem.id, source: "app" });
      setPendingTransition(transition);
      return;
    }

    await commitMove(id, status);
  }

  async function handleResume(item: WorkItem) {
    if (focusItem && focusItem.id !== item.id) {
      void recordActivityEvent({ eventType: "pause_requested", workItemId: focusItem.id, source: "app" });
      setPendingTransition({ targetId: item.id, targetStatus: "focus", openContextAfter: true });
      return;
    }
    const moved = await commitMove(item.id, "focus");
    if (moved) setContextItem(item);
  }

  async function handleApplySuggestion(suggestion: StatusSuggestion) {
    const item = items.find((candidate) => candidate.id === suggestion.workItemId);
    if (item && suggestion.proposedStatus === "done") {
      setPendingCompletion(item);
      return;
    }
    if (item?.status === "focus" && suggestion.proposedStatus !== "focus" && suggestion.proposedStatus !== "done") {
      void recordActivityEvent({ eventType: "pause_requested", workItemId: item.id, source: "app" });
      setPendingTransition({
        targetId: item.id,
        targetStatus: suggestion.proposedStatus,
        suggestionId: suggestion.id,
      });
      return;
    }
    await applyStatusSuggestion(suggestion.id);
    await refresh();
  }

  async function handleRename(id: string, title: string) {
    await updateWorkItemTitle(id, title);
    await refresh();
  }

  function handleTaskSortMode(mode: TaskSortMode) {
    setTaskSortMode(mode);
    window.localStorage.setItem(TASK_SORT_STORAGE_KEY, mode);
  }

  async function handleTaskReorder(status: WorkItemStatus, orderedIds: string[]) {
    setItems((current) => current.map((item) => {
      const position = item.status === status ? orderedIds.indexOf(item.id) : -1;
      return position >= 0 ? { ...item, position } : item;
    }));
    try {
      await reorderWorkItems(status, orderedIds);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    }
  }

  return (
    <div className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""} ${focusItem ? "has-focus-lock" : ""}`}>
      {shortcutError && (
        <div className="global-shortcut-error" role="alert">
          <div><strong>전역 단축키를 사용할 수 없습니다.</strong><span>{shortcutError}</span></div>
          <button type="button" onClick={() => { setShortcutError(null); setActiveSection("settings"); }}>Settings 열기</button>
          <button type="button" aria-label="알림 닫기" onClick={() => setShortcutError(null)}><X size={14} /></button>
        </div>
      )}
      <aside className="sidebar" inert={focusItem ? true : undefined} aria-hidden={focusItem ? true : undefined}>
        <div className="traffic-lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="brand">
          <div><strong>Orbit</strong><span>{formatToday()}</span></div>
          <button
            className="sidebar-toggle"
            type="button"
            title={isSidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-label={isSidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
            onClick={() => setIsSidebarCollapsed((current) => {
              window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(!current));
              return !current;
            })}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={17} strokeWidth={1.7} /> : <PanelLeftClose size={17} strokeWidth={1.7} />}
          </button>
        </div>

        <nav aria-label="주요 메뉴">
          <button className={`nav-item ${activeSection === "dashboard" ? "active" : ""}`} type="button" title="Dashboard" onClick={() => setActiveSection("dashboard")}>
            <span className="nav-symbol"><LayoutDashboard size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Dashboard
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "tasks" ? "active" : ""}`}
            type="button"
            title="Task"
            onClick={() => setActiveSection("tasks")}
          >
            <span className="nav-symbol"><CheckSquare size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Task
            <b>{items.filter((item) => item.status !== "done").length || ""}</b>
          </button>
          <button
            className={`nav-item ${activeSection === "jira" ? "active" : ""}`}
            type="button"
            title="Jira Tickets"
            onClick={() => setActiveSection("jira")}
          >
            <span className="nav-symbol"><Ticket size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Jira Tickets
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "chat" ? "active" : ""}`}
            type="button"
            title="Chat"
            onClick={() => setActiveSection("chat")}
          >
            <span className="nav-symbol"><MessageCircle size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Chat
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "graph" ? "active" : ""}`}
            type="button"
            title="Graph"
            onClick={() => setActiveSection("graph")}
          >
            <span className="nav-symbol"><Network size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Graph
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "calendar" ? "active" : ""}`}
            type="button"
            title="Calendar"
            onClick={() => setActiveSection("calendar")}
          >
            <span className="nav-symbol"><Calendar size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Calendar
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "sessions" ? "active" : ""}`}
            type="button"
            title="Workspace"
            onClick={() => setActiveSection("sessions")}
          >
            <span className="nav-symbol"><LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Workspace
            <b />
          </button>
          <button
            className={`nav-item ${activeSection === "pull_requests" ? "active" : ""}`}
            type="button"
            title="Pull Requests"
            onClick={() => setActiveSection("pull_requests")}
          >
            <span className="nav-symbol"><GitPullRequest size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            Pull Requests
            <b />
          </button>

          <div className="nav-separator" />
          <button className="nav-item nav-item-muted" type="button" title="Integrations" disabled>
            <span className="nav-symbol"><Plug size={16} strokeWidth={1.75} aria-hidden="true" /></span> Integrations <b />
          </button>
          <button
            className={`nav-item ${activeSection === "settings" ? "active" : ""}`}
            type="button"
            title="Settings"
            onClick={() => setActiveSection("settings")}
          >
            <span className="nav-symbol"><Settings size={16} strokeWidth={1.75} aria-hidden="true" /></span> Settings <b />
          </button>
        </nav>

        <div className="sync-status" aria-label="연동 상태">
          <span className={`sync-dot ${sourceSyncStates.some((state) => ["failed", "auth-required", "rate-limited", "partial", "stale"].includes(state.status)) ? "needs-attention" : ""}`} />
          {sourceSyncStates.length === 0
            ? "연동 상태 확인"
            : sourceSyncStates.some((state) => ["failed", "auth-required", "rate-limited"].includes(state.status))
              ? "연동 확인 필요"
              : `${sourceSyncStates.filter((state) => state.status === "fresh").length}/${sourceSyncStates.length}개 최신`}
        </div>
      </aside>

      <main ref={workspaceRef} className="workspace">
        <header className="topbar" inert={focusItem ? true : undefined} aria-hidden={focusItem ? true : undefined}>
          <div>
            <h1>{activeSection === "dashboard" ? "Dashboard" : activeSection === "tasks" ? "Task" : activeSection === "calendar" ? "Calendar" : activeSection === "chat" ? "Chat" : activeSection === "graph" ? "Graph" : activeSection === "sessions" ? "Workspace" : activeSection === "jira" ? "Jira Tickets" : activeSection === "pull_requests" ? "Pull Requests" : "Settings"}</h1>
            <span>{formatToday()}</span>
          </div>
          {activeSection === "tasks" && (
            <button className="primary-button primary-button-icon" type="button" onClick={() => setIsComposerOpen(true)}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" /> 작업 추가
            </button>
          )}
        </header>

        {activeSection === "dashboard" ? (
          <DashboardPage
            workItems={items}
            onResume={(item) => { void handleResume(item); }}
            onOpenContext={setContextItem}
          />
        ) : activeSection === "calendar" ? (
          <CalendarPage />
        ) : activeSection === "chat" ? (
          <ChatPage />
        ) : activeSection === "graph" ? (
          <GraphPage />
        ) : activeSection === "sessions" ? (
          <WorkspacePage
            workItems={items}
            onWorkItemsChanged={refresh}
            onOpenTask={(id) => {
              setActiveSection("tasks");
              const linked = items.find((item) => item.id === id);
              if (linked) setContextItem(linked);
            }}
          />
        ) : activeSection === "jira" ? (
          <JiraTicketsPage workItems={items} />
        ) : activeSection === "pull_requests" ? (
          <PullRequestsPage workItems={items} />
        ) : activeSection === "settings" ? (
          <SettingsPage />
        ) : (
          <>
        {error && (
          <div className="error-banner">
            작업을 변경하지 못했습니다.
            <small>{error}</small>
          </div>
        )}

        {statusSuggestions.length > 0 && (
          <StatusSuggestionRail
            isLocked={Boolean(focusItem)}
            suggestions={statusSuggestions}
            items={items}
            onApply={async (id) => {
              const suggestion = statusSuggestions.find((candidate) => candidate.id === id);
              if (suggestion) await handleApplySuggestion(suggestion);
            }}
            onIgnore={async (id) => { await ignoreStatusSuggestion(id); await refresh(); }}
          />
        )}

        <TaskBoard
          items={groupedItems}
          isLoading={isLoading}
          onMove={handleMove}
          onRename={handleRename}
          onOpenContext={setContextItem}
          onDelete={setDeleteItem}
          sessionProgress={sessionProgress}
          onAdd={() => setIsComposerOpen(true)}
          sortMode={taskSortMode}
          onSortModeChange={handleTaskSortMode}
          onReorder={handleTaskReorder}
        />
          </>
        )}
      </main>

      {isComposerOpen && (
        <TaskComposer
          onClose={() => setIsComposerOpen(false)}
          onCreated={async (task) => {
            setIsComposerOpen(false);
            if (task.collectAiContext) setDiscoveryTask(task);
            await refresh();
          }}
        />
      )}
      {discoveryTask && (
        <TaskContextDiscoveryModal
          task={discoveryTask}
          onClose={() => setDiscoveryTask(null)}
          onConnected={async () => {
            setDiscoveryTask(null);
            await refresh();
          }}
        />
      )}

      {pendingTransition && focusItem && (
        <InterruptionDialog
          item={focusItem}
          evidence={interruptionEvidence}
          draft={interruptionDraft}
          targetStatus={pendingTransition.targetId === focusItem.id ? pendingTransition.targetStatus : "todo"}
          destination={
            pendingTransition.targetId === focusItem.id
              ? statusMeta[pendingTransition.targetStatus].label
              : items.find((item) => item.id === pendingTransition.targetId)?.title || "다음 작업"
          }
          onCancel={() => {
            void recordActivityEvent({ eventType: "pause_cancelled", workItemId: focusItem.id, source: "app" });
            setPendingTransition(null);
          }}
          onConfirm={async (values: InterruptionValues) => {
            if (pendingTransition.targetStatus === "focus" && pendingTransition.targetId !== focusItem.id) {
              const requested = items.find((item) => item.id === pendingTransition.targetId);
              if (!requested) throw new Error("재개할 작업을 찾을 수 없습니다.");
              const slot = await getFocusSlot();
              await switchFocusedWorkItem({
                currentWorkItemId: focusItem.id,
                requestedWorkItemId: requested.id,
                expectedSlotRevision: slot.revision,
                expectedCurrentRevision: focusItem.revision,
                expectedRequestedRevision: requested.revision,
                releaseStatus: "ai_running",
                ...values,
              });
              if (pendingTransition.openContextAfter) setContextItem(requested);
            } else {
              const releaseStatus = pendingTransition.targetStatus as "todo" | "ai_running" | "review" | "blocked";
              const slot = await getFocusSlot();
              await switchFocusedWorkItem({
                currentWorkItemId: focusItem.id,
                requestedWorkItemId: null,
                expectedSlotRevision: slot.revision,
                expectedCurrentRevision: focusItem.revision,
                expectedRequestedRevision: null,
                releaseStatus,
                correlationId: pendingTransition.suggestionId,
                ...values,
              });
            }
            await refresh();
            if ((interruptionDraft.checkpoint && values.checkpoint === interruptionDraft.checkpoint)
              || (interruptionDraft.nextAction && values.nextAction === interruptionDraft.nextAction)) {
              void recordAutomationApproval({
                ruleKind: "prepare-draft",
                normalizedSourceIdentity: "checkpoint:evidence-draft",
                approved: true,
                confidence: 1,
              });
            }
            setPendingTransition(null);
          }}
        />
      )}

      {pendingCompletion && (
        <CompletionSheet
          item={pendingCompletion}
          evidence={completionEvidence}
          onCancel={() => setPendingCompletion(null)}
          onComplete={async (values) => {
            await completeWorkItem({
              workItemId: pendingCompletion.id,
              expectedRevision: pendingCompletion.revision,
              resultSummary: values.resultSummary,
              decisions: values.decisions,
              remainingRisk: values.remainingRisks,
              retrospective: values.retrospective,
              evidence: completionEvidence,
            });
            setPendingCompletion(null);
            await refresh();
          }}
        />
      )}

      {contextItem && (
        <TaskContextModal
          item={items.find((item) => item.id === contextItem.id) || contextItem}
          onClose={() => setContextItem(null)}
          onChanged={refresh}
        />
      )}
      {deleteItem && (
        <DeleteTaskModal
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
          onConfirm={async () => {
            await deleteWorkItem(deleteItem.id);
            setDeleteItem(null);
            await refresh();
          }}
        />
      )}
      {isQuickPanelOpen && (
        <QuickPanel
          items={quickPanelItems}
          shortcutLabel={displayShortcut(getRegisteredShortcuts()?.quickPanel ?? DEFAULT_QUICK_PANEL_SHORTCUT)}
          onClose={() => setIsQuickPanelOpen(false)}
          onOpenTask={(item) => {
            setIsQuickPanelOpen(false);
            setActiveSection("tasks");
            setContextItem(item);
          }}
          onStartFocus={async (item) => {
            setIsQuickPanelOpen(false);
            setActiveSection("tasks");
            await handleMove(item.id, "focus");
          }}
          onCreateTask={() => { setIsQuickPanelOpen(false); setActiveSection("tasks"); setIsComposerOpen(true); }}
          onOpenChat={() => { setIsQuickPanelOpen(false); setActiveSection("chat"); }}
        />
      )}
      {activeSection === "tasks" && !focusItem && <TaskAiFix items={items} onApplied={refresh} />}
    </div>
  );
}

function StatusSuggestionRail({
  isLocked,
  suggestions,
  items,
  onApply,
  onIgnore,
}: {
  isLocked: boolean;
  suggestions: StatusSuggestion[];
  items: WorkItem[];
  onApply: (id: string) => Promise<void>;
  onIgnore: (id: string) => Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  return (
    <section className="status-suggestion-rail" aria-label="상태 변경 제안" inert={isLocked ? true : undefined} aria-hidden={isLocked ? true : undefined}>
      <header><div><Sparkles size={14} /><strong>확인할 상태 제안</strong></div><span>{suggestions.length}개</span></header>
      <div>
        {suggestions.slice(0, 4).map((suggestion) => {
          const item = items.find((candidate) => candidate.id === suggestion.workItemId);
          return (
            <article key={suggestion.id}>
              <div><span>{suggestion.source.toUpperCase()} · {statusMeta[suggestion.proposedStatus].label}</span><strong>{item?.title || "삭제된 작업"}</strong><p>{suggestion.reason}</p></div>
              <div>
                <button type="button" disabled={pendingId === suggestion.id} onClick={() => { setPendingId(suggestion.id); void onIgnore(suggestion.id).finally(() => setPendingId(null)); }}>무시</button>
                <button className="primary-button" type="button" disabled={pendingId === suggestion.id} onClick={() => { setPendingId(suggestion.id); void onApply(suggestion.id).finally(() => setPendingId(null)); }}>적용</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TaskRow({
  item,
  progress,
  onMove,
  onRename,
  onOpenContext,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging = false,
  isFocusLocked = false,
  boardCard = false,
}: {
  item: WorkItem;
  progress?: WorkItemSessionProgress;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onOpenContext: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  onDragStart?: (event: DragEvent<HTMLElement>, item: WorkItem) => void;
  onDragOver?: (event: DragEvent<HTMLElement>, item: WorkItem) => void;
  onDrop?: (event: DragEvent<HTMLElement>, item: WorkItem) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isFocusLocked?: boolean;
  boardCard?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (boardCard && item.status === "focus") cardRef.current?.focus();
  }, [boardCard, item.id, item.status]);

  async function submitTitle(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      setRenameError(null);
      await onRename(item.id, title);
      setIsEditing(false);
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <article
      ref={cardRef}
      className={`task-row ${boardCard ? `task-board-card status-${item.status}` : ""} ${item.status === "review" ? "needs-review" : ""} ${onDragStart ? "is-sortable" : ""} ${isDragging ? "is-dragging" : ""} ${isFocusLocked ? "is-focus-locked" : ""}`}
      draggable={Boolean(onDragStart) && item.status !== "focus" && !isFocusLocked}
      inert={isFocusLocked ? true : undefined}
      aria-hidden={isFocusLocked ? true : undefined}
      tabIndex={boardCard ? 0 : undefined}
      aria-label={boardCard ? `${item.title}, ${statusMeta[item.status].label}.${item.status === "focus" ? " 다른 화면이 잠겨 있습니다. 집중 종료 또는 완료를 선택할 수 있습니다." : " 드래그하거나 Alt와 좌우 방향키로 상태를 이동할 수 있습니다."}` : undefined}
      onDragStart={onDragStart ? (event) => onDragStart(event, item) : undefined}
      onDragOver={onDragOver ? (event) => onDragOver(event, item) : undefined}
      onDrop={onDrop ? (event) => onDrop(event, item) : undefined}
      onDragEnd={onDragEnd}
      onKeyDown={boardCard ? (event) => {
        if (item.status === "focus") return;
        if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        const currentIndex = taskBoardLanes.indexOf(taskBoardLaneForStatus(item.status));
        const nextIndex = currentIndex + (event.key === "ArrowRight" ? 1 : -1);
        const nextStatus = taskBoardLanes[nextIndex];
        if (!nextStatus) return;
        event.preventDefault();
        void onMove(item.id, nextStatus);
      } : undefined}
    >
      <header className="task-card-header">
        <span className={`task-card-status ${item.status}`}><i aria-hidden="true" />{statusMeta[item.status].label}</span>
        <div className="task-card-header-actions" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsMenuOpen(false);
        }}>
          <span className="task-card-source">{item.source === "orbit" ? "LOCAL" : item.source.toUpperCase()}</span>
          <button type="button" aria-label={`${item.title} 작업 메뉴`} aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((current) => !current)}><MoreHorizontal size={16} /></button>
          {isMenuOpen && (
            <div className="task-card-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); onOpenContext(item); }}><Link2 size={13} /> 컨텍스트 보기</button>
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); setIsEditing(true); }}><Pencil size={13} /> 이름 수정</button>
              {item.status === "ai_running" && <>
                <div className="task-card-menu-divider" />
                <button className="focus-action" type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); void onMove(item.id, "focus"); }}><LockKeyhole size={13} /> 집중 시작</button>
              </>}
              {item.status !== "focus" && <>
              <div className="task-card-menu-divider" />
              {taskBoardLanes.filter((status) => status !== taskBoardLaneForStatus(item.status)).map((status) => (
                <button type="button" role="menuitem" key={status} onClick={() => { setIsMenuOpen(false); void onMove(item.id, status); }}>
                  <span className={`task-card-menu-dot ${status}`} /> {taskBoardLaneMeta[status].label}로 이동
                </button>
              ))}
              </>}
              {item.status !== "focus" && <><div className="task-card-menu-divider" />
                <button className="danger" type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); onDelete(item); }}><Trash2 size={13} /> 삭제</button></>}
            </div>
          )}
        </div>
      </header>
      <div className="task-copy">
        {isEditing ? (
          <form className="task-title-editor" onSubmit={submitTitle}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus aria-label="작업 이름" />
            <button className="task-title-save" type="submit" aria-label="작업 이름 저장"><Check size={14} strokeWidth={2} aria-hidden="true" /></button>
            <button type="button" aria-label="취소" onClick={() => { setTitle(item.title); setIsEditing(false); }}><X size={14} strokeWidth={2} aria-hidden="true" /></button>
          </form>
        ) : <strong onDoubleClick={() => setIsEditing(true)}>{item.title}</strong>}
        {(item.nextAction || item.goal) && <p className="task-card-summary">{item.nextAction || item.goal}</p>}
        {renameError && <small className="task-inline-error">{renameError}</small>}
      </div>
      <div className="task-card-meta">
        <span>생성 {formatWorkItemCreatedAt(item.createdAt)}</span>
        <span>{progress ? `AI 세션 ${progress.done}/${progress.total} 완료` : "연결된 AI 세션 없음"}</span>
      </div>
      {(item.priority || item.targetAt) && <div className="task-planning-meta">
        {item.priority && <small className={`task-priority-tag ${item.priority}`}>{item.priority.toUpperCase()}</small>}
        {item.targetAt && <small className={`task-target-time ${new Date(item.targetAt).getTime() <= Date.now() ? "is-overdue" : ""}`}><AlarmClock size={12} strokeWidth={1.8} aria-hidden="true" />{formatWorkItemTargetAt(item.targetAt)}</small>}
      </div>}
      {item.status === "focus" ? (
        <footer className="task-card-focus-actions">
          <button type="button" onClick={() => onOpenContext(item)}><Link2 size={13} /> 컨텍스트</button>
          <button type="button" onClick={() => { void onMove(item.id, "ai_running"); }}>집중 종료</button>
          <button className="primary-button" type="button" onClick={() => { void onMove(item.id, "done"); }}><Check size={13} /> 완료</button>
        </footer>
      ) : (
        <footer className="task-card-footer">
          <span className="task-card-drag-cue"><GripVertical size={14} strokeWidth={1.8} aria-hidden="true" /> 드래그해서 이동</span>
          <span>⌥ ← →</span>
        </footer>
      )}
    </article>
  );
}

function TaskBoard({
  items,
  isLoading,
  onMove,
  onRename,
  onOpenContext,
  onDelete,
  sessionProgress,
  onAdd,
  sortMode,
  onSortModeChange,
  onReorder,
}: {
  items: Record<WorkItemStatus, WorkItem[]>;
  isLoading: boolean;
  onMove: (id: string, status: WorkItemStatus) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onOpenContext: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  sessionProgress: Record<string, WorkItemSessionProgress>;
  onAdd: () => void;
  sortMode: TaskSortMode;
  onSortModeChange: (mode: TaskSortMode) => void;
  onReorder: (status: WorkItemStatus, orderedIds: string[]) => Promise<void>;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingStatus, setDraggingStatus] = useState<TaskBoardLane | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskBoardLane | null>(null);
  const [isSortUnlockOpen, setIsSortUnlockOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const laneItems = useMemo(() => {
    const next: Record<TaskBoardLane, WorkItem[]> = { todo: [], ai_running: [], done: [] };
    workItemStatuses.forEach((status) => {
      items[status].forEach((item) => next[taskBoardLaneForStatus(item.status)].push(item));
    });
    return next;
  }, [items]);
  const sortedItems = useMemo(() => Object.fromEntries(
    taskBoardLanes.map((status) => {
      const sorted = sortWorkItems(laneItems[status], sortMode);
      if (status === "ai_running") {
        sorted.sort((left, right) => Number(right.status === "focus") - Number(left.status === "focus"));
      }
      return [status, sorted];
    }),
  ) as Record<TaskBoardLane, WorkItem[]>, [laneItems, sortMode]);
  const focusLocked = items.focus.length > 0;

  function startDrag(event: DragEvent<HTMLElement>, item: WorkItem) {
    const origin = event.target as HTMLElement;
    if (origin.closest("button, input, textarea, a")) {
      event.preventDefault();
      return;
    }
    if (sortMode !== "manual") {
      event.preventDefault();
      setIsSortUnlockOpen(true);
      return;
    }
    setDraggingId(item.id);
    setDraggingStatus(taskBoardLaneForStatus(item.status));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  }

  async function dropItem(event: DragEvent<HTMLElement>, status: TaskBoardLane, target?: WorkItem) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverStatus(null);
    if (!draggingId || !draggingStatus) return;

    const dragged = laneItems[draggingStatus].find((item) => item.id === draggingId);
    if (!dragged) return;

    if (draggingStatus !== status) {
      setAnnouncement(`${dragged.title}을 ${taskBoardLaneMeta[status].label}로 이동합니다.`);
      setDraggingId(null);
      setDraggingStatus(null);
      await onMove(dragged.id, status);
      return;
    }

    if (!target || draggingId === target.id) {
      setDraggingId(null);
      setDraggingStatus(null);
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const placeAfter = event.clientY > bounds.top + bounds.height / 2;
    const orderedIds = reorderWorkItemIds(sortedItems[status].map(({ id }) => id), draggingId, target.id, placeAfter);
    setDraggingId(null);
    setDraggingStatus(null);
    setAnnouncement(`${dragged.title}의 순서를 변경했습니다.`);
    await onReorder(dragged.status, orderedIds.filter((id) => laneItems[status].some((item) => item.id === id && item.status === dragged.status)));
  }

  function finishDrag() {
    setDraggingId(null);
    setDraggingStatus(null);
    setDragOverStatus(null);
  }

  return (
    <>
    <section className={`task-board-page ${focusLocked ? "is-focus-locked" : ""}`} aria-label="Task 보드">
      <header className="task-board-toolbar" inert={focusLocked ? true : undefined} aria-hidden={focusLocked ? true : undefined}>
        <div>
          <h2>작업 보드</h2>
          <p>카드를 세로로 확인하고 다른 열로 드래그해 상태를 바꿀 수 있어요.</p>
        </div>
        <div className="task-sort-actions">
          <span>{items.todo.length + items.focus.length + items.ai_running.length + items.review.length + items.blocked.length + items.inbox.length + items.done.length}개</span>
          <label>
            <span className="sr-only">Task 정렬 방식</span>
            <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as TaskSortMode)}>
              <option value="manual">수동 정렬</option>
              <option value="newest">최신 생성순</option>
              <option value="oldest">오래된 생성순</option>
            </select>
          </label>
        </div>
      </header>

      {isLoading ? (
        <div className="empty-state">작업을 불러오는 중…</div>
      ) : (
        <div className="task-board-scroll">
          <div className="task-board">
            {taskBoardLanes.map((status) => {
              const isLockedColumn = focusLocked && status !== "ai_running";
              const isFocusColumn = focusLocked && status === "ai_running";
              return (
              <section
                className={`task-board-column task-board-column-${status} ${isFocusColumn ? "is-focus-column" : ""} ${isLockedColumn ? "is-locked" : ""} ${dragOverStatus === status ? "is-drag-over" : ""}`}
                key={status}
                aria-labelledby={`task-column-${status}`}
                inert={isLockedColumn ? true : undefined}
                aria-hidden={isLockedColumn ? true : undefined}
                onDragOver={(event) => {
                  if (!draggingId || isLockedColumn) return;
                  event.preventDefault();
                  setDragOverStatus(status);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverStatus(null);
                }}
                onDrop={(event) => { void dropItem(event, status); }}
              >
                <header className="task-board-column-header">
                  <div>
                    <span className={`task-board-status-dot ${status}`} aria-hidden="true" />
                    <div>
                      <h3 id={`task-column-${status}`}>{taskBoardLaneMeta[status].label}</h3>
                      <p>{taskBoardLaneMeta[status].description}</p>
                    </div>
                  </div>
                  <span className="task-board-count" aria-label={`${laneItems[status].length}개`}>{laneItems[status].length}</span>
                </header>

                {isFocusColumn && (
                  <div className="focus-lock-banner" role="status"><LockKeyhole size={14} /> 현재 한 작업에 집중 중</div>
                )}

                <div className="task-board-list">
                  {sortedItems[status].map((item) => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      progress={sessionProgress[item.id]}
                      onMove={onMove}
                      onRename={onRename}
                      onOpenContext={onOpenContext}
                      onDelete={onDelete}
                      onDragStart={startDrag}
                      onDragOver={(event) => { if (draggingId) event.preventDefault(); }}
                      onDrop={(event, target) => { void dropItem(event, status, target); }}
                      onDragEnd={finishDrag}
                      isDragging={draggingId === item.id}
                      isFocusLocked={focusLocked && item.id !== items.focus[0]?.id}
                      boardCard
                    />
                  ))}
                  {sortedItems[status].length === 0 && (
                    <div className="task-board-empty">
                      <strong>{taskBoardLaneMeta[status].label} 작업이 없습니다</strong>
                      <span>{status === "todo" ? "새 작업을 추가하거나 카드를 여기로 옮겨보세요." : "다른 열의 카드를 여기로 옮겨보세요."}</span>
                      {status === "todo" && <button type="button" onClick={onAdd}><Plus size={13} /> 작업 추가</button>}
                    </div>
                  )}
                </div>
              </section>
              );
            })}
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{focusLocked ? `${items.focus[0]?.title} 작업에 집중 중입니다. 다른 화면은 잠겼습니다.` : announcement}</p>
    </section>
    {isSortUnlockOpen && (
      <div className="modal-backdrop" onMouseDown={() => setIsSortUnlockOpen(false)}>
        <section className="sort-unlock-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="sort-unlock-icon"><GripVertical size={18} strokeWidth={1.8} /></div>
          <h2>정렬을 해제하시겠습니까?</h2>
          <p>현재 날짜순으로 정렬되어 있습니다. 드래그로 순서를 바꾸려면 수동 정렬로 전환해야 합니다.</p>
          <div>
            <button type="button" onClick={() => setIsSortUnlockOpen(false)}>아니요</button>
            <button className="primary-button" type="button" onClick={() => { onSortModeChange("manual"); setIsSortUnlockOpen(false); }}>예, 정렬 해제</button>
          </div>
        </section>
      </div>
    )}
    </>
  );
}

function DeleteTaskModal({
  item,
  onClose,
  onConfirm,
}: {
  item: WorkItem;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setIsDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="delete-task-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="delete-task-icon"><Trash2 size={18} strokeWidth={1.8} aria-hidden="true" /></div>
        <h2>Task를 삭제할까요?</h2>
        <strong>{item.title}</strong>
        <p>Jira·GitHub 연결은 함께 제거됩니다. AI 세션 원본은 유지되고 이 Task와의 연결만 해제됩니다.</p>
        {error && <div className="context-error">{error}</div>}
        <div className="delete-task-actions">
          <button type="button" onClick={onClose} disabled={isDeleting}>취소</button>
          <button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={isDeleting}>{isDeleting ? "삭제 중…" : "삭제"}</button>
        </div>
      </section>
    </div>
  );
}

function TaskComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (task: { id: string; title: string; description: string; collectAiContext: boolean }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkItemPriority | null>(null);
  const [collectAiContext, setCollectAiContext] = useState(true);
  const [targetAt, setTargetAt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      if (targetAt && !(await requestTaskReminderPermission())) {
        throw new Error("macOS 알림 권한을 허용해야 목표 시간 알림을 받을 수 있습니다.");
      }
      const normalizedTitle = title.trim();
      const normalizedDescription = description.trim();
      const id = await createWorkItem({
        title: normalizedTitle,
        goal: normalizedDescription,
        status: "todo",
        priority,
        targetAt: targetAt ? new Date(targetAt).toISOString() : null,
      });
      await onCreated({ id, title: normalizedTitle, description: normalizedDescription, collectAiContext });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="composer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="composer-heading">
          <div><span>새 Orbit Task</span><h2>무엇을 해야 하나요?</h2></div>
          <button type="button" onClick={onClose} aria-label="닫기"><X size={18} strokeWidth={1.8} aria-hidden="true" /></button>
        </div>
        <label>작업 제목<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: GitHub OAuth callback 구현" autoFocus /></label>
        <label>Description <span>선택</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="상세 설명을 적으면 AI가 더 컨텍스트를 잘 가져와요!" rows={4} /></label>
        <fieldset className="composer-priority">
          <legend>우선순위 <span>선택</span></legend>
          <div className="composer-priority-options">
            {([
              { value: null, label: "미지정", detail: "나중에 결정" },
              { value: "p1", label: "P1", detail: "가장 먼저" },
              { value: "p2", label: "P2", detail: "중요" },
              { value: "p3", label: "P3", detail: "여유" },
            ] as const).map((option) => (
              <label
                className={`composer-priority-option ${option.value ?? "none"}`}
                key={option.label}
              >
                <input className="sr-only" type="radio" name="priority" checked={priority === option.value} onChange={() => setPriority(option.value)} />
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <label>목표 시간 <span>선택</span><input type="datetime-local" value={targetAt} onChange={(event) => setTargetAt(event.target.value)} /><small className="composer-field-help">이 시간까지 완료되지 않으면 Mac 알림을 한 번 보내드려요.</small></label>
        <label className="composer-ai-context-option">
          <input type="checkbox" checked={collectAiContext} onChange={(event) => setCollectAiContext(event.target.checked)} />
          <span><strong>AI Context 수집</strong><small>Task 생성 후 관련 AI 세션, Jira 티켓과 Slack 메시지를 찾습니다.</small></span>
        </label>
        {saveError && <div className="composer-error" role="alert">저장하지 못했습니다. <small>{saveError}</small></div>}
        <div className="composer-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button className="primary-button" type="submit" disabled={isSaving || !title.trim()}>{isSaving ? "저장 중…" : "작업 추가"}</button>
        </div>
      </form>
    </div>
  );
}

function TaskTargetEditor({ item, onChanged }: { item: WorkItem; onChanged: () => Promise<void> }) {
  const [targetAt, setTargetAt] = useState(() => toDateTimeLocalValue(item.targetAt));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setTargetAt(toDateTimeLocalValue(item.targetAt));
  }, [item.targetAt]);

  async function saveTarget(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      if (targetAt && !(await requestTaskReminderPermission())) {
        throw new Error("시스템 설정에서 Orbit의 알림을 허용해주세요.");
      }
      await updateWorkItemTargetAt(item.id, targetAt ? new Date(targetAt).toISOString() : null);
      await onChanged();
      setMessage(targetAt ? "목표 시간과 알림을 저장했습니다." : "목표 시간을 해제했습니다.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="task-target-editor" onSubmit={saveTarget}>
      <div className="task-target-heading">
        <i><AlarmClock size={16} strokeWidth={1.8} aria-hidden="true" /></i>
        <span><strong>목표 시간</strong><small>미완료 상태로 시간이 지나면 Mac 알림을 한 번 보냅니다.</small></span>
      </div>
      <div className="task-target-controls">
        <input type="datetime-local" value={targetAt} onChange={(event) => { setTargetAt(event.target.value); setMessage(null); }} aria-label="목표 시간" />
        {item.targetAt && <button type="button" onClick={() => setTargetAt("")} disabled={isSaving}>해제</button>}
        <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "저장 중…" : "저장"}</button>
      </div>
      {message && <p>{message}</p>}
    </form>
  );
}

function TaskContextModal({ item, onClose, onChanged }: { item: WorkItem; onClose: () => void; onChanged: () => Promise<void> }) {
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [links, setLinks] = useState<WorkItemLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isJiraSyncing, setIsJiraSyncing] = useState(false);
  const [isJiraLinkEditorOpen, setIsJiraLinkEditorOpen] = useState(false);
  const [jiraReference, setJiraReference] = useState("");
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [jiraTaskLinks, setJiraTaskLinks] = useState<JiraTaskLink[]>([]);
  const [isLoadingJiraIssues, setIsLoadingJiraIssues] = useState(false);
  const [isManualJiraReference, setIsManualJiraReference] = useState(false);
  const [isCreatingJiraLink, setIsCreatingJiraLink] = useState(false);
  const [development, setDevelopment] = useState<JiraIssueDevelopment[]>([]);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [autoConnectMessage, setAutoConnectMessage] = useState<string | null>(null);
  const syncedJiraLinksRef = useRef(new Set<string>());

  const refreshContext = useCallback(async () => {
    const [nextSessions, nextLinks] = await Promise.all([
      listAiSessions(),
      listWorkItemLinks(item.id),
    ]);
    setSessions(nextSessions);
    setLinks(nextLinks);
  }, [item.id]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDevelopment([]);
    setIsJiraLinkEditorOpen(false);
    setJiraReference("");
    setJiraIssues([]);
    setJiraTaskLinks([]);
    setIsManualJiraReference(false);
    void refreshContext().then(async () => {
      const [nextSessions, nextLinks] = await Promise.all([listAiSessions(), listWorkItemLinks(item.id)]);
      const cwds = nextSessions
        .filter((session) => session.linkedWorkItemId === item.id && session.cwd)
        .map((session) => session.cwd as string);
      const jiraLinks = nextLinks.filter((link) => link.kind === "jira" && link.externalId);
      if (jiraLinks.length === 0 || cancelled) return;
      const cached = await Promise.all(jiraLinks.map((link) =>
        getCachedJiraIssueDevelopment(link.externalId!)));
      if (cancelled) return;
      setDevelopment(cached.flatMap((entry) => entry ? [entry.development] : []));
      const linksToRefresh = jiraLinks.filter((_, index) => shouldRefreshJiraDevelopment(cached[index]));
      if (linksToRefresh.length === 0) return;

      setIsJiraSyncing(true);
      try {
        const byIssueKey = new Map(cached.flatMap((entry) => entry
          ? [[entry.development.issue.key, entry.development] as const]
          : []));
        for (const link of linksToRefresh) {
          if (cancelled || syncedJiraLinksRef.current.has(link.id)) continue;
          syncedJiraLinksRef.current.add(link.id);
          const fresh = await syncJiraIssueDevelopment(item.id, link.id, link.externalId!, cwds);
          byIssueKey.set(fresh.issue.key, fresh);
        }
        if (!cancelled) {
          setDevelopment(jiraLinks.flatMap((link) => {
            const value = byIssueKey.get(link.externalId!);
            return value ? [value] : [];
          }));
          setLinks(await listWorkItemLinks(item.id));
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setIsJiraSyncing(false);
      }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [item.id, refreshContext]);

  const linkedSessions = sessions.filter((session) => session.linkedWorkItemId === item.id);

  async function disconnectSession(session: AiSession) {
    await linkAiSession(session.provider, session.sessionId, null);
    await refreshContext();
    await onChanged();
  }

  async function toggleSessionCompletion(session: AiSession) {
    const nextState = session.completionState === "done" ? "active" : "done";
    await setAiSessionCompletion(
      session.provider,
      session.sessionId,
      nextState,
    );
    const nextStates = linkedSessions.map((candidate) =>
      candidate.provider === session.provider && candidate.sessionId === session.sessionId
        ? nextState
        : candidate.completionState,
    );
    const proposedStatus = taskStatusSuggestionForSessions(nextStates);
    if (proposedStatus && proposedStatus !== item.status) {
      await createStatusSuggestion({
        workItemId: item.id,
        source: "ai_session",
        proposedStatus,
        reason: proposedStatus === "review"
          ? "연결된 AI 세션이 모두 완료되어 결과 확인이 필요합니다."
          : "연결된 AI 세션에서 진행 중인 작업이 관측되었습니다.",
      });
    }
    await refreshContext();
    await onChanged();
  }

  async function autoConnectSessions() {
    setIsAutoConnecting(true);
    setAutoConnectMessage(null);
    try {
      setError(null);
      const result = await autoConnectTaskAiSessions(item.id, item.title, item.goal || "");
      setAutoConnectMessage(result.connected.length > 0
        ? `${result.connected.length}개의 관련 세션을 자동으로 연결했습니다.`
        : "관련도가 충분히 높은 AI 세션을 찾지 못했습니다.");
      await refreshContext();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsAutoConnecting(false);
    }
  }

  async function addJiraLink(event: FormEvent) {
    event.preventDefault();
    const issueKey = extractJiraKey(jiraReference);
    if (!issueKey) {
      setError("CGKR-123 형식의 Jira 이슈 키 또는 Jira URL을 입력해주세요.");
      return;
    }

    setIsCreatingJiraLink(true);
    setError(null);
    try {
      const linkId = await createWorkItemLink(item.id, "jira", jiraReference);
      setJiraReference("");
      setIsJiraLinkEditorOpen(false);
      await refreshContext();
      await onChanged();

      setIsJiraSyncing(true);
      try {
        const nextSessions = await listAiSessions();
        const cwds = nextSessions
          .filter((session) => session.linkedWorkItemId === item.id && session.cwd)
          .map((session) => session.cwd as string);
        const fresh = await syncJiraIssueDevelopment(item.id, linkId, issueKey, cwds);
        setDevelopment([fresh]);
        setLinks(await listWorkItemLinks(item.id));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(`Jira 링크는 추가했지만 개발 정보 동기화에 실패했습니다. ${message}`);
      } finally {
        setIsJiraSyncing(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsCreatingJiraLink(false);
    }
  }

  async function openJiraLinkEditor() {
    setError(null);
    setJiraReference("");
    setIsManualJiraReference(false);
    setIsJiraLinkEditorOpen(true);
    setIsLoadingJiraIssues(true);

    let cachedIssues: JiraIssue[] = [];
    try {
      const [nextIssues, nextTaskLinks] = await Promise.all([
        listCachedJiraIssues(),
        listJiraTaskLinks(),
      ]);
      cachedIssues = nextIssues;
      setJiraIssues(nextIssues);
      setJiraTaskLinks(nextTaskLinks);

      try {
        await refreshAssignedJiraIssues();
        const [refreshedIssues, refreshedTaskLinks] = await Promise.all([
          listCachedJiraIssues(),
          listJiraTaskLinks(),
        ]);
        setJiraIssues(refreshedIssues);
        setJiraTaskLinks(refreshedTaskLinks);
      } catch (cause) {
        if (cachedIssues.length === 0) throw cause;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoadingJiraIssues(false);
    }
  }

  const jiraLinks = links.filter((link) => link.kind === "jira");
  const slackLinks = links.filter((link) => link.kind === "slack");
  const jiraTaskLinkByKey = new Map(jiraTaskLinks.map((link) => [link.issueKey.toUpperCase(), link]));
  const jiraComboboxOptions: SearchComboboxOption[] = [
    ...jiraIssues.map((issue) => {
      const linkedTask = jiraTaskLinkByKey.get(issue.key.toUpperCase());
      return {
        value: issue.key,
        label: issue.key,
        description: issue.summary,
        meta: linkedTask ? `${linkedTask.workItemTitle}에 연결됨` : issue.status,
        keywords: `${issue.key} ${issue.summary} ${issue.status} ${issue.projectKey} ${issue.projectName}`,
        disabled: Boolean(linkedTask),
      };
    }),
    {
      value: "__manual__",
      label: "목록에 없음",
      description: "Jira 키 또는 URL 직접 입력",
      keywords: "직접 입력 manual",
      alwaysVisible: true,
    },
  ];
  const showManualJiraReference = isManualJiraReference || (!isLoadingJiraIssues && jiraIssues.length === 0);

  return (
    <div className="modal-backdrop task-context-backdrop" onMouseDown={onClose}>
      <section className="task-context-modal task-context-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>Task · Context</span><h2>{item.title}</h2><p>{item.goal || "Jira와 GitHub 개발 흐름, AI 작업 세션을 한곳에서 확인합니다."}</p><small>생성 {formatWorkItemCreatedAt(item.createdAt)}</small></div>
          <button type="button" onClick={onClose} aria-label="닫기"><X size={18} strokeWidth={1.8} aria-hidden="true" /></button>
        </header>

        <TaskTargetEditor item={item} onChanged={onChanged} />

        <DevelopmentSection development={development} isLoading={isJiraSyncing} />

        <div className="context-section">
          <div className="context-section-title"><strong>Jira</strong><span>{isJiraSyncing ? "개발 정보 동기화 중…" : `${jiraLinks.length}개 연결됨`}</span></div>
          {jiraLinks.map((link) => (
            <div className="context-link-row external" key={link.id}>
              <i className="service jira"><ServiceIcon kind="jira" size={17} /></i>
              <div><strong>{link.label}</strong><span>Jira 이슈{link.status !== "linked" ? ` · ${link.status}` : ""}</span></div>
              <div className="context-row-actions">
                {link.externalUrl && <button type="button" onClick={() => void openUrl(link.externalUrl!)}>열기</button>}
                <button type="button" onClick={async () => { await deleteWorkItemLink(link.id); await refreshContext(); }}>해제</button>
              </div>
            </div>
          ))}
          {jiraLinks.length === 0 && !isJiraLinkEditorOpen && (
            <div className="context-empty-row context-empty-action">
              <span>연결된 Jira 티켓이 없습니다.</span>
              <button type="button" onClick={() => void openJiraLinkEditor()}>
                <Link2 size={13} strokeWidth={1.8} aria-hidden="true" /> 링크 추가
              </button>
            </div>
          )}
          {jiraLinks.length === 0 && isJiraLinkEditorOpen && (
            <form className="context-jira-link-form" onSubmit={(event) => void addJiraLink(event)}>
              <label htmlFor={`jira-issue-${item.id}`}>연결할 Jira 티켓</label>
              <SearchCombobox
                id={`jira-issue-${item.id}`}
                value={isManualJiraReference ? "__manual__" : jiraReference}
                options={jiraComboboxOptions}
                placeholder={jiraIssues.length > 0 ? "티켓 번호 또는 제목 검색" : "동기화된 티켓이 없습니다"}
                emptyMessage="일치하는 Jira 티켓이 없습니다."
                loading={isLoadingJiraIssues}
                onChange={(value) => {
                  setError(null);
                  if (value === "__manual__") {
                    setJiraReference("");
                    setIsManualJiraReference(true);
                    return;
                  }
                  setIsManualJiraReference(false);
                  setJiraReference(value);
                }}
                disabled={isCreatingJiraLink || isLoadingJiraIssues}
                autoFocus
              />
              {showManualJiraReference && (
                <input
                  id={`jira-reference-${item.id}`}
                  aria-label="Jira 이슈 키 또는 URL 직접 입력"
                  value={jiraReference}
                  onChange={(event) => { setJiraReference(event.target.value); setError(null); }}
                  placeholder="CGKR-123 또는 Jira URL"
                  disabled={isCreatingJiraLink}
                />
              )}
              <div className="context-jira-link-actions">
                <button type="button" onClick={() => { setJiraReference(""); setIsJiraLinkEditorOpen(false); setError(null); }} disabled={isCreatingJiraLink}>취소</button>
                <button className="primary-button" type="submit" disabled={isCreatingJiraLink || !jiraReference.trim()}>{isCreatingJiraLink ? "연결 중…" : "연결"}</button>
              </div>
              <small>내게 할당된 Jira 티켓입니다. 연결하면 Jira 상태와 PR·커밋 정보를 함께 불러옵니다.</small>
            </form>
          )}
        </div>

        <div className="context-section">
          <div className="context-section-title"><strong>Slack</strong><span>{slackLinks.length}개 연결됨</span></div>
          {slackLinks.map((link) => (
            <div className="context-link-row external slack-link-row" key={link.id}>
              <i className="service slack"><ServiceIcon kind="slack" size={17} /></i>
              <div><strong>{link.label}</strong><span>Slack 원문 메시지</span></div>
              <div className="context-row-actions">
                {link.externalUrl && <button type="button" onClick={() => void openUrl(link.externalUrl!)}>원문</button>}
                {link.externalId && <button type="button" onClick={async () => { await saveSlackMessageToInbox(link.externalId!); setAutoConnectMessage("Slack 메시지를 Inbox에 저장했습니다."); }}>Inbox 저장</button>}
                <button type="button" onClick={async () => { await deleteWorkItemLink(link.id); await refreshContext(); }}>해제</button>
              </div>
            </div>
          ))}
          {slackLinks.length === 0 && <div className="context-empty-row">연결된 Slack 메시지가 없습니다.</div>}
        </div>

        <div className="context-section ai-auto-section">
          <div className="context-section-title"><strong>AI 작업 세션</strong><span>{linkedSessions.length}개 연결됨</span></div>
          <button className="ai-auto-connect" type="button" onClick={() => void autoConnectSessions()} disabled={isAutoConnecting}>
            <i><Sparkles size={15} strokeWidth={1.8} aria-hidden="true" /></i>
            <span><strong>{isAutoConnecting ? "AI가 관련 세션을 찾는 중…" : "AI로 세션 자동 연결"}</strong><small>Task 제목·Description과 최근 대화를 분석해 관련도가 높은 세션만 연결합니다.</small></span>
            <b>{isAutoConnecting ? "분석 중" : "자동 연결"}</b>
          </button>
          {autoConnectMessage && <p className="ai-auto-message">{autoConnectMessage}</p>}
          {linkedSessions.map((session) => (
            <div className="context-link-row" key={`${session.provider}:${session.sessionId}`}>
              <i className={`service ${serviceIconForProvider(session.provider)}`}><ServiceIcon kind={serviceIconForProvider(session.provider)} size={17} /></i>
              <div><strong>{displaySessionTitle(session)}</strong><span>{session.provider === "claude" ? "Claude" : "Codex"} · {projectName(session.cwd)} · {session.completionState === "done" ? "완료" : "진행 중"}</span></div>
              <div className="context-row-actions">
                <button className={session.completionState === "done" ? "done" : ""} type="button" onClick={() => void toggleSessionCompletion(session)}>{session.completionState === "done" ? "다시 진행" : "완료 표시"}</button>
                <button type="button" onClick={() => void disconnectSession(session)}>해제</button>
              </div>
            </div>
          ))}
        </div>
        {error && <div className="context-error">{error}</div>}
      </section>
    </div>
  );
}

function DevelopmentSection({ development, isLoading }: {
  development: JiraIssueDevelopment[];
  isLoading: boolean;
}) {
  const branches = development.flatMap((item) => item.branches);
  const commits = development.flatMap((item) => item.commits);
  const pullRequests = development.flatMap((item) => item.pullRequests);
  const builds = development.flatMap((item) => item.builds);
  const warnings = [...new Set(development.flatMap((item) => item.warnings))];
  const tickets = development.map((item) => `${item.issue.key} · ${item.issue.summary}`).join(", ");

  return (
    <div className="context-section development-section">
      <div className="context-section-title">
        <strong>Development</strong>
        <span>{isLoading ? "GitHub 개발 정보 찾는 중…" : tickets}</span>
      </div>
      <div className="development-summary" aria-label="GitHub 개발 정보 요약">
        <DevelopmentMetric icon={GitBranch} label="브랜치" count={branches.length} />
        <DevelopmentMetric icon={GitCommitHorizontal} label="커밋" count={commits.length} />
        <DevelopmentMetric icon={GitPullRequest} label="Pull request" count={pullRequests.length} />
        <DevelopmentMetric icon={CircleCheck} label="빌드" count={builds.length} tone={builds.some((build) => build.conclusion === "failure") ? "danger" : "success"} />
      </div>
      {!isLoading && branches.length + commits.length + pullRequests.length + builds.length === 0 && (
        <div className="development-empty">Jira 티켓 키가 포함된 GitHub 개발 정보를 찾지 못했습니다.</div>
      )}
      <DevelopmentDetails
        label="브랜치"
        items={branches.map((branch) => ({
          id: `${branch.repository}:${branch.name}`,
          title: branch.name,
          meta: branch.repository,
          url: branch.url,
        }))}
      />
      <DevelopmentDetails
        label="커밋"
        items={commits.map((commit) => ({
          id: `${commit.repository}:${commit.sha}`,
          title: `${commit.sha.slice(0, 7)} · ${commit.message}`,
          meta: `${commit.repository}${commit.authorName ? ` · ${commit.authorName}` : ""}`,
          url: commit.url,
        }))}
      />
      <DevelopmentDetails
        label="Pull requests"
        items={pullRequests.map((pullRequest) => ({
          id: `${pullRequest.repository}:${pullRequest.number}`,
          title: `#${pullRequest.number} · ${pullRequest.title}`,
          meta: `${pullRequest.repository} · ${formatDevelopmentStatus(pullRequest.status)}`,
          url: pullRequest.url,
        }))}
      />
      <DevelopmentDetails
        label="빌드"
        items={builds.map((build) => ({
          id: `${build.repository}:${build.id}`,
          title: build.name,
          meta: `${build.repository} · ${build.branch} · ${formatDevelopmentStatus(build.conclusion || build.status)}`,
          url: build.url,
        }))}
      />
      {warnings.length > 0 && <p className="development-warning">{warnings.join(" ")}</p>}
    </div>
  );
}

function DevelopmentMetric({ icon: Icon, label, count, tone = "" }: {
  icon: LucideIcon;
  label: string;
  count: number;
  tone?: "" | "success" | "danger";
}) {
  return (
    <div className={tone}>
      <i><Icon size={14} strokeWidth={1.8} aria-hidden="true" /></i>
      <span><strong>{count}</strong>{label}</span>
    </div>
  );
}

function DevelopmentDetails({ label, items }: {
  label: string;
  items: Array<{ id: string; title: string; meta: string; url: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <details className="development-details">
      <summary>{label}<span>{items.length}</span></summary>
      <div>
        {items.map((item) => (
          <button type="button" onClick={() => void openUrl(item.url)} key={item.id}>
            <span><strong>{item.title}</strong><small>{item.meta}</small></span>
            <b>열기</b>
          </button>
        ))}
      </div>
    </details>
  );
}

function formatDevelopmentStatus(value: string) {
  const labels: Record<string, string> = {
    open: "열림",
    closed: "닫힘",
    merged: "병합됨",
    completed: "완료",
    success: "성공",
    failure: "실패",
    in_progress: "진행 중",
    queued: "대기 중",
  };
  return labels[value.toLocaleLowerCase()] || value;
}

export default App;
