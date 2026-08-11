import { Plus } from "lucide-react";
import { formatToday, sectionTitle, type PrimarySection } from "../model/navigation";

interface AppHeaderProps {
  activeSection: PrimarySection;
  isFocusLocked: boolean;
  onAddTask: () => void;
}

export default function AppHeader({ activeSection, isFocusLocked, onAddTask }: AppHeaderProps) {
  if (activeSection === "dashboard") return null;
  return (
    <header className="topbar" inert={isFocusLocked ? true : undefined} aria-hidden={isFocusLocked ? true : undefined}>
      <div><h1>{sectionTitle[activeSection]}</h1><span>{formatToday()}</span></div>
      {activeSection === "tasks" && (
        <button className="primary-button primary-button-icon" type="button" onClick={onAddTask}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" /> 작업 추가
        </button>
      )}
    </header>
  );
}
