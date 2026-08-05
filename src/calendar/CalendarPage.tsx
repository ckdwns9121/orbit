import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createCalendarEvent, listCalendarEvents } from "../data/calendar-event-repository";
import {
  getGoogleCalendarConnection,
  shouldAutoSyncGoogleCalendar,
  syncGoogleCalendar,
  type GoogleCalendarConnection,
} from "../data/google-calendar-repository";
import { getAppSettings } from "../data/settings-repository";
import {
  addDays,
  isSameDay,
  startOfWeek,
  weekDays,
  type CalendarEvent,
} from "../domain/calendar-event";
import "./CalendarPage.scss";

const dayFormatter = new Intl.DateTimeFormat("ko-KR", { weekday: "short" });
const monthDayFormatter = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleTimes() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return { start, end: addDaysByMilliseconds(start, 60 * 60 * 1_000) };
}

function addDaysByMilliseconds(date: Date, milliseconds: number) {
  return new Date(date.getTime() + milliseconds);
}

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [googleConnection, setGoogleConnection] = useState<GoogleCalendarConnection | null>(null);
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setEvents(await listCalendarEvents(weekStart, weekEnd));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, [weekEnd, weekStart]);

  useEffect(() => {
    setIsLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshGoogle(false);
    // Calendar 주가 바뀔 때마다 연결 상태는 다시 확인하되, 15분 캐시가 API 재호출을 막습니다.
  }, [weekStart]);

  async function refreshGoogle(force: boolean) {
    try {
      const [connection, settings] = await Promise.all([getGoogleCalendarConnection(), getAppSettings()]);
      setGoogleConnection(connection);
      if (!connection || !settings.google_client_id || (!force && !shouldAutoSyncGoogleCalendar(connection))) return;
      setIsSyncingGoogle(true);
      const updated = await syncGoogleCalendar(settings.google_client_id);
      setGoogleConnection(updated);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSyncingGoogle(false);
    }
  }

  const weekLabel = `${monthDayFormatter.format(days[0])} – ${monthDayFormatter.format(days[6])}`;

  return (
    <div className="calendar-page">
      <div className="calendar-toolbar">
        <div className="calendar-navigation">
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))}>오늘</button>
          <div>
            <button type="button" aria-label="이전 주" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
            <button type="button" aria-label="다음 주" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
          </div>
          <strong>{weekLabel}</strong>
        </div>
        <div className="calendar-toolbar-actions">
          {googleConnection && <button type="button" disabled={isSyncingGoogle} onClick={() => void refreshGoogle(true)}>{isSyncingGoogle ? "동기화 중…" : "↻ Google 동기화"}</button>}
          <button className="primary-button" type="button" onClick={() => setIsComposerOpen(true)}>+ 일정 추가</button>
        </div>
      </div>

      {error && <div className="calendar-error">일정을 불러오지 못했습니다. <small>{error}</small></div>}

      <section className="week-calendar" aria-label={`${weekLabel} 주간 일정`}>
        {days.map((day) => {
          const dayEvents = events.filter((event) => isSameDay(new Date(event.startAt), day));
          const isToday = isSameDay(day, new Date());
          return (
            <article className={`calendar-day ${isToday ? "is-today" : ""}`} key={day.toISOString()}>
              <header>
                <span>{dayFormatter.format(day)}</span>
                <strong>{day.getDate()}</strong>
              </header>
              <div className="calendar-day-events">
                {dayEvents.map((event) => (
                  <div className={`calendar-event source-${event.source}`} key={event.id}>
                    <span>{event.allDay ? "종일" : timeFormatter.format(new Date(event.startAt))}</span>
                    <strong>{event.title}</strong>
                    {event.location && <small>{event.location}</small>}
                  </div>
                ))}
                {!isLoading && dayEvents.length === 0 && <span className="no-events">일정 없음</span>}
              </div>
            </article>
          );
        })}
      </section>

      <div className="calendar-legend">
        <span><i className="local" /> 로컬 일정</span>
        <span className={googleConnection ? "" : "future-source"}><i className="google" /> {googleConnection ? `Google Calendar · ${googleConnection.email}` : "Settings에서 Google Calendar 연결"}</span>
      </div>

      {isComposerOpen && (
        <ScheduleComposer
          onClose={() => setIsComposerOpen(false)}
          onCreated={async () => {
            setIsComposerOpen(false);
            setWeekStart(startOfWeek(new Date()));
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ScheduleComposer({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const defaults = useMemo(defaultScheduleTimes, []);
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState(toDateTimeLocalValue(defaults.start));
  const [endAt, setEndAt] = useState(toDateTimeLocalValue(defaults.end));
  const [location, setLocation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await createCalendarEvent({ title, startAt, endAt, location });
      await onCreated();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="schedule-composer" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="schedule-composer-heading">
          <div><span>새 로컬 일정</span><h2>일정을 추가하세요</h2></div>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <label>일정 제목<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 프론트엔드 주간 회의" autoFocus /></label>
        <div className="schedule-time-fields">
          <label>시작<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
          <label>종료<input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label>
        </div>
        <label>장소 또는 링크<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="선택 사항" /></label>
        {saveError && <div className="schedule-error" role="alert">{saveError}</div>}
        <div className="schedule-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button className="primary-button" type="submit" disabled={!title.trim() || isSaving}>{isSaving ? "저장 중…" : "일정 추가"}</button>
        </div>
      </form>
    </div>
  );
}
