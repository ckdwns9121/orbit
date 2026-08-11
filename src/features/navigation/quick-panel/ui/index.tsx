import { CheckSquare, MessageCircle, Plus, Target, X } from "lucide-react";
import type { WorkItem } from "../../../../entities/work-context/model/work-item";
import "./style.scss";

export default function QuickPanel({
  items,
  shortcutLabel,
  onClose,
  onOpenTask,
  onStartFocus,
  onCreateTask,
  onOpenChat,
}: {
  items: WorkItem[];
  shortcutLabel: string;
  onClose: () => void;
  onOpenTask: (item: WorkItem) => void;
  onStartFocus: (item: WorkItem) => Promise<void>;
  onCreateTask: () => void;
  onOpenChat: () => void;
}) {
  return (
    <div className="quick-panel-backdrop" onMouseDown={onClose}>
      <section className="quick-panel" role="dialog" aria-modal="true" aria-labelledby="quick-panel-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
        <header>
          <div><span>TODAY</span><h2 id="quick-panel-title">오늘 할 일</h2></div>
          <button type="button" onClick={onClose} aria-label="퀵 패널 닫기"><X size={18} strokeWidth={1.8} /></button>
        </header>

        <div className="quick-panel-list">
          {items.length ? items.map((item) => (
            <article key={item.id} className={item.status === "focus" ? "is-focus" : ""}>
              <button className="quick-panel-task" type="button" onClick={() => onOpenTask(item)}>
                <span><CheckSquare size={15} strokeWidth={1.8} /></span>
                <div><strong>{item.title}</strong><small>{item.nextAction || item.checkpoint || statusLabel(item)}</small></div>
              </button>
              {item.status === "ai_running" && (
                <button className="quick-panel-focus" type="button" onClick={() => void onStartFocus(item)} title="집중 시작">
                  <Target size={14} strokeWidth={1.8} /> 집중
                </button>
              )}
            </article>
          )) : (
            <div className="quick-panel-empty"><CheckSquare size={25} strokeWidth={1.4} /><strong>오늘 할 일이 없습니다</strong><span>새 Task를 추가해 실행 순서를 만들어보세요.</span></div>
          )}
        </div>

        <footer>
          <button type="button" onClick={onCreateTask}><Plus size={14} strokeWidth={2} /> 새 Task</button>
          <button type="button" onClick={onOpenChat}><MessageCircle size={14} strokeWidth={1.8} /> Chat 열기</button>
          <kbd>{shortcutLabel}</kbd>
        </footer>
      </section>
    </div>
  );
}

function statusLabel(item: WorkItem) {
  if (item.status === "focus") return "지금 집중 중";
  if (item.status === "review") return "내 확인 필요";
  if (item.status === "ai_running") return "진행 중";
  if (item.status === "blocked") return "막힌 작업";
  return "할 일";
}
