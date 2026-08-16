import {
  Calendar,
  CheckSquare,
  Blocks,
  LayoutDashboard,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  TicketCheck,
  type LucideIcon,
} from "lucide-react";
import type { SourceSyncState } from "../../entities/work-context/model/work-continuity";
import type { WorkItem } from "../../entities/work-context/model/work-item";
import { formatToday, type PrimarySection } from "../model/navigation";

interface NavigationItem {
  section: PrimarySection;
  label: string;
  icon: LucideIcon;
  count?: number;
}

interface AppSidebarProps {
  activeSection: PrimarySection;
  collapsed: boolean;
  isFocusLocked: boolean;
  items: WorkItem[];
  sourceSyncStates: SourceSyncState[];
  onNavigate: (section: PrimarySection) => void;
  onToggleCollapsed: () => void;
}

export default function AppSidebar({
  activeSection,
  collapsed,
  isFocusLocked,
  items,
  sourceSyncStates,
  onNavigate,
  onToggleCollapsed,
}: AppSidebarProps) {
  const navigation: NavigationItem[] = [
    { section: "dashboard", label: "Planner", icon: LayoutDashboard },
    { section: "tasks", label: "Task", icon: CheckSquare, count: items.filter((item) => item.status !== "done").length },
    { section: "calendar", label: "Calendar", icon: Calendar },
    { section: "sessions", label: "Workspace", icon: Blocks },
    { section: "jira", label: "Tickets", icon: TicketCheck },
    { section: "chat", label: "Chat", icon: MessageCircle },
  ];
  const hasSyncProblem = sourceSyncStates.some((state) =>
    ["failed", "auth-required", "rate-limited", "partial", "stale"].includes(state.status),
  );

  return (
    <aside className="sidebar" inert={isFocusLocked ? true : undefined} aria-hidden={isFocusLocked ? true : undefined}>
      <div className="brand">
        <div><strong>Orbit</strong><span>{formatToday()}</span></div>
        <button
          className="sidebar-toggle"
          type="button"
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen size={17} strokeWidth={1.7} /> : <PanelLeftClose size={17} strokeWidth={1.7} />}
        </button>
      </div>
      <nav aria-label="주요 메뉴">
        {navigation.map(({ section, label, icon: Icon, count }) => (
          <button
            key={section}
            className={`nav-item ${activeSection === section ? "active" : ""}`}
            type="button"
            title={label}
            onClick={() => onNavigate(section)}
          >
            <span className="nav-symbol"><Icon size={16} strokeWidth={1.75} aria-hidden="true" /></span>
            {label}
            <b>{count || ""}</b>
          </button>
        ))}
        <div className="nav-separator" />
        <button className="nav-item nav-item-muted" type="button" title="Integrations" disabled>
          <span className="nav-symbol"><Plug size={16} strokeWidth={1.75} aria-hidden="true" /></span> Integrations <b />
        </button>
        <button
          className={`nav-item ${activeSection === "settings" ? "active" : ""}`}
          type="button"
          title="Settings"
          onClick={() => onNavigate("settings")}
        >
          <span className="nav-symbol"><Settings size={16} strokeWidth={1.75} aria-hidden="true" /></span> Settings <b />
        </button>
      </nav>
      <div className="sync-status" aria-label="연동 상태">
        <span className={`sync-dot ${hasSyncProblem ? "needs-attention" : ""}`} />
        {sourceSyncStates.length === 0
          ? "연동 상태 확인"
          : sourceSyncStates.some((state) => ["failed", "auth-required", "rate-limited"].includes(state.status))
            ? "연동 확인 필요"
            : `${sourceSyncStates.filter((state) => state.status === "fresh").length}/${sourceSyncStates.length}개 최신`}
      </div>
    </aside>
  );
}
