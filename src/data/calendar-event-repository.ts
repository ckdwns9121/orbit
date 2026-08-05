import type {
  CalendarEvent,
  CalendarEventSource,
  CreateCalendarEventInput,
} from "../domain/calendar-event";
import { getDatabase } from "./database";

interface CalendarEventRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: number;
  source: CalendarEventSource;
  external_id: string | null;
  external_url: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day === 1,
    source: row.source,
    externalId: row.external_id,
    externalUrl: row.external_url,
    location: row.location,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCalendarEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const database = await getDatabase();
  const rows = await database.select<CalendarEventRow[]>(
    `SELECT id, title, start_at, end_at, all_day, source, external_id,
            external_url, location, notes, created_at, updated_at
     FROM calendar_events
     WHERE start_at < $1 AND end_at > $2
     ORDER BY start_at ASC`,
    [to.toISOString(), from.toISOString()],
  );

  return rows.map(toCalendarEvent);
}

export async function createCalendarEvent(input: CreateCalendarEventInput): Promise<void> {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (!input.title.trim()) throw new Error("일정 제목을 입력해주세요.");
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error("올바른 시작 및 종료 시간을 입력해주세요.");
  }
  if (endAt <= startAt) throw new Error("종료 시간은 시작 시간보다 늦어야 합니다.");

  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO calendar_events (
      id, title, start_at, end_at, all_day, source, location, notes, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'local', $6, $7, $8, $8)`,
    [
      crypto.randomUUID(),
      input.title.trim(),
      startAt.toISOString(),
      endAt.toISOString(),
      input.allDay ? 1 : 0,
      input.location?.trim() || null,
      input.notes?.trim() || null,
      now,
    ],
  );
}
