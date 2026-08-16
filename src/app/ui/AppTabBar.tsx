import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Blocks,
  Calendar,
  CheckSquare,
  GitPullRequest,
  LayoutDashboard,
  MessageCircle,
  Network,
  Plus,
  Settings,
  TicketCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { primarySections, sectionTitle, type PrimarySection } from "../model/navigation";

const sectionIcon: Record<PrimarySection, LucideIcon> = {
  dashboard: LayoutDashboard,
  tasks: CheckSquare,
  calendar: Calendar,
  chat: MessageCircle,
  graph: Network,
  sessions: Blocks,
  jira: TicketCheck,
  pull_requests: GitPullRequest,
  settings: Settings,
};

interface AppTabBarProps {
  activeSection: PrimarySection;
  openSections: PrimarySection[];
  isFocusLocked: boolean;
  onActivate: (section: PrimarySection) => void;
  onClose: (section: PrimarySection) => void;
}

export default function AppTabBar({
  activeSection,
  openSections,
  isFocusLocked,
  onActivate,
  onClose,
}: AppTabBarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const suppressTabActivationRef = useRef(false);

  function beginWindowDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    let listening = true;

    const cleanup = () => {
      if (!listening) return;
      listening = false;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };
    const handleMove = (moveEvent: PointerEvent) => {
      if (Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 4) return;
      cleanup();
      suppressTabActivationRef.current = true;
      window.setTimeout(() => { suppressTabActivationRef.current = false; }, 250);
      void getCurrentWindow().startDragging().catch(() => {
        suppressTabActivationRef.current = false;
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", cleanup, { once: true });
    window.addEventListener("pointercancel", cleanup, { once: true });
  }

  useEffect(() => {
    if (!isMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  return (
    <header
      className="app-titlebar"
      data-tauri-drag-region
      inert={isFocusLocked ? true : undefined}
      aria-hidden={isFocusLocked ? true : undefined}
    >
      <div className="app-titlebar-traffic-pad" data-tauri-drag-region />
      <div className="app-tab-strip" role="tablist" aria-label="열린 화면" data-tauri-drag-region>
        {openSections.map((section) => {
          const Icon = sectionIcon[section];
          const isActive = activeSection === section;
          return (
            <div className={`app-tab ${isActive ? "active" : ""}`} key={section}>
              <button
                className="app-tab-activate"
                type="button"
                role="tab"
                aria-selected={isActive}
                title={sectionTitle[section]}
                onPointerDown={beginWindowDrag}
                onClick={() => {
                  if (suppressTabActivationRef.current) return;
                  onActivate(section);
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) onClose(section);
                }}
              >
                <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>{sectionTitle[section]}</span>
              </button>
              <button
                className="app-tab-close"
                type="button"
                aria-label={`${sectionTitle[section]} 탭 닫기`}
                onClick={() => onClose(section)}
              >
                <X size={12} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="app-tab-create" ref={menuRef}>
        <button
          type="button"
          aria-label="새 탭 열기"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {isMenuOpen && (
          <div className="app-tab-menu" role="menu">
            {primarySections.map((section) => {
              const Icon = sectionIcon[section];
              return (
                <button
                  type="button"
                  role="menuitem"
                  key={section}
                  onClick={() => {
                    onActivate(section);
                    setIsMenuOpen(false);
                  }}
                >
                  <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                  {sectionTitle[section]}
                  {openSections.includes(section) && <span>열림</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="app-titlebar-drag-tail" data-tauri-drag-region />
    </header>
  );
}
