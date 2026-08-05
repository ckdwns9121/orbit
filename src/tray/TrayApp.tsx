import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listWorkItems, moveWorkItem } from "../data/work-item-repository";
import type { WorkItem } from "../domain/work-item";
import "./TrayApp.scss";

function formatTrayDate() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

export default function TrayApp() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listWorkItems());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_000);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void invoke("hide_tray_window");
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [refresh]);

  const focusItem = items.find((item) => item.status === "focus");
  const nextItems = useMemo(
    () => items.filter((item) => item.status === "review" || item.status === "todo").slice(0, 3),
    [items],
  );
  const reviewCount = items.filter((item) => item.status === "review").length;
  const aiCount = items.filter((item) => item.status === "ai_running").length;

  async function complete(item: WorkItem) {
    await moveWorkItem(item.id, "done");
    await refresh();
  }

  async function start(item: WorkItem) {
    if (focusItem) {
      await invoke("show_main_window");
      return;
    }

    await moveWorkItem(item.id, "focus");
    await refresh();
  }

  return (
    <main className="tray-shell">
      <header className="tray-header">
        <div>
          <strong>Orbit</strong>
          <span>{formatTrayDate()}</span>
        </div>
        <button type="button" onClick={() => invoke("show_main_window")} aria-label="전체 앱 열기">↗</button>
      </header>

      {error && <div className="tray-error">로컬 작업을 불러오지 못했습니다.</div>}

      <section className={`tray-focus ${focusItem ? "" : "is-empty"}`}>
        <span className="tray-eyebrow"><i /> 지금 집중</span>
        {focusItem ? (
          <>
            <h1>{focusItem.title}</h1>
            <p>{focusItem.nextAction || "다음 행동을 기록해보세요."}</p>
            {focusItem.checkpoint && (
              <div className="tray-checkpoint">
                <span>체크포인트</span>
                {focusItem.checkpoint}
              </div>
            )}
            <div className="tray-focus-actions">
              <button className="tray-primary" type="button" onClick={() => complete(focusItem)}>완료</button>
              <button type="button" onClick={() => invoke("show_main_window")}>전환·기록</button>
            </div>
          </>
        ) : (
          <div className="tray-no-focus">
            <strong>집중 중인 작업이 없습니다</strong>
            <span>아래 작업에서 하나를 시작하세요.</span>
          </div>
        )}
      </section>

      <section className="tray-next">
        <div className="tray-section-title">
          <h2>다음 작업</h2>
          <span>{nextItems.length}</span>
        </div>

        {isLoading ? (
          <div className="tray-empty">불러오는 중…</div>
        ) : nextItems.length > 0 ? (
          <div className="tray-task-list">
            {nextItems.map((item) => (
              <article className={item.status === "review" ? "needs-review" : ""} key={item.id}>
                <button className="tray-check" type="button" onClick={() => complete(item)} aria-label={`${item.title} 완료`} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.nextAction || (item.status === "review" ? "내 확인 필요" : "할 일")}</span>
                </div>
                <button className="tray-start" type="button" onClick={() => start(item)}>{focusItem ? "전환" : "시작"}</button>
              </article>
            ))}
          </div>
        ) : (
          <div className="tray-empty">다음 작업이 없습니다.</div>
        )}
      </section>

      <footer className="tray-footer">
        <button type="button" onClick={() => invoke("show_main_window")}>
          <span>내 확인 필요</span><strong>{reviewCount}</strong>
        </button>
        <button type="button" onClick={() => invoke("show_main_window")}>
          <span>AI 작업 중</span><strong>{aiCount}</strong>
        </button>
        <button className="open-app" type="button" onClick={() => invoke("show_main_window")}>전체 앱 열기</button>
      </footer>
    </main>
  );
}
