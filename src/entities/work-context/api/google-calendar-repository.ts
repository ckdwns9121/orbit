import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "./database";

const PRIMARY_CALENDAR_ID = "primary";
const INITIAL_PAST_DAYS = 90;
const INITIAL_FUTURE_DAYS = 365;

export interface GoogleCalendarConnection {
  email: string;
  connectedAt: string;
  lastSyncedAt: string | null;
}

interface GoogleOAuthResult {
  email: string;
}

interface GoogleCalendarApiEvent {
  id: string;
  title: string;
  status: string;
  startDateTime: string | null;
  startDate: string | null;
  endDateTime: string | null;
  endDate: string | null;
  htmlLink: string | null;
  location: string | null;
  notes: string | null;
  updated: string | null;
}

interface GoogleCalendarSyncResult {
  events: GoogleCalendarApiEvent[];
  nextSyncToken: string | null;
  resetRequired: boolean;
}

interface GoogleCalendarSyncRow {
  account_email: string;
  sync_token: string | null;
  connected_at: string;
  last_synced_at: string | null;
}

export async function getGoogleCalendarConnection(): Promise<GoogleCalendarConnection | null> {
  const database = await getDatabase();
  const rows = await database.select<GoogleCalendarSyncRow[]>(
    `SELECT account_email, sync_token, connected_at, last_synced_at
     FROM google_calendar_sync WHERE calendar_id = $1`,
    [PRIMARY_CALENDAR_ID],
  );
  const row = rows[0];
  return row ? { email: row.account_email, connectedAt: row.connected_at, lastSyncedAt: row.last_synced_at } : null;
}

export async function connectGoogleCalendar(clientId: string): Promise<GoogleCalendarConnection> {
  const result = await invoke<GoogleOAuthResult>("connect_google_calendar", {
    clientId: clientId.trim(),
    clientSecret: null,
  });
  const now = new Date().toISOString();
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO google_calendar_sync (calendar_id, account_email, sync_token, connected_at, last_synced_at)
     VALUES ($1, $2, NULL, $3, NULL)
     ON CONFLICT(calendar_id) DO UPDATE SET
       account_email = excluded.account_email,
       sync_token = NULL,
       connected_at = excluded.connected_at,
       last_synced_at = NULL`,
    [PRIMARY_CALENDAR_ID, result.email, now],
  );
  await database.execute("DELETE FROM calendar_events WHERE source = 'google'");
  await syncGoogleCalendar(clientId);
  return (await getGoogleCalendarConnection())!;
}

export async function syncGoogleCalendar(clientId: string): Promise<GoogleCalendarConnection> {
  const database = await getDatabase();
  const rows = await database.select<GoogleCalendarSyncRow[]>(
    `SELECT account_email, sync_token, connected_at, last_synced_at
     FROM google_calendar_sync WHERE calendar_id = $1`,
    [PRIMARY_CALENDAR_ID],
  );
  const state = rows[0];
  if (!state) throw new Error("먼저 Google 계정을 연결해주세요.");

  const initialRange = getInitialSyncRange();
  const result = await invoke<GoogleCalendarSyncResult>("sync_google_calendar", {
    clientId: clientId.trim(),
    clientSecret: null,
    syncToken: state.sync_token,
    timeMin: state.sync_token ? null : initialRange.timeMin,
    timeMax: state.sync_token ? null : initialRange.timeMax,
  });

  if (result.resetRequired) {
    await database.execute("DELETE FROM calendar_events WHERE source = 'google'");
    await database.execute(
      "UPDATE google_calendar_sync SET sync_token = NULL WHERE calendar_id = $1",
      [PRIMARY_CALENDAR_ID],
    );
    return syncGoogleCalendar(clientId);
  }

  const now = new Date().toISOString();
  for (const event of result.events) {
    if (event.status === "cancelled") {
      await database.execute(
        "DELETE FROM calendar_events WHERE source = 'google' AND external_id = $1",
        [event.id],
      );
      continue;
    }
    const normalized = normalizeGoogleEvent(event);
    if (!normalized) continue;
    await database.execute(
      `INSERT INTO calendar_events (
        id, title, start_at, end_at, all_day, source, external_id,
        external_url, location, notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'google', $6, $7, $8, $9, $10, $11)
      ON CONFLICT(source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
        title = excluded.title,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        all_day = excluded.all_day,
        external_url = excluded.external_url,
        location = excluded.location,
        notes = excluded.notes,
        updated_at = excluded.updated_at`,
      [
        `google:${event.id}`,
        event.title,
        normalized.startAt,
        normalized.endAt,
        normalized.allDay ? 1 : 0,
        event.id,
        event.htmlLink,
        event.location,
        event.notes,
        now,
        event.updated ?? now,
      ],
    );
  }

  await database.execute(
    `UPDATE google_calendar_sync
     SET sync_token = $1, last_synced_at = $2
     WHERE calendar_id = $3`,
    [result.nextSyncToken ?? state.sync_token, now, PRIMARY_CALENDAR_ID],
  );
  return (await getGoogleCalendarConnection())!;
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await invoke("disconnect_google_calendar");
  const database = await getDatabase();
  await database.execute("DELETE FROM calendar_events WHERE source = 'google'");
  await database.execute("DELETE FROM google_calendar_sync WHERE calendar_id = $1", [PRIMARY_CALENDAR_ID]);
}

export function shouldAutoSyncGoogleCalendar(connection: GoogleCalendarConnection | null, now = Date.now()): boolean {
  if (!connection) return false;
  if (!connection.lastSyncedAt) return true;
  return now - new Date(connection.lastSyncedAt).getTime() >= 15 * 60 * 1_000;
}

export function normalizeGoogleEvent(event: GoogleCalendarApiEvent): { startAt: string; endAt: string; allDay: boolean } | null {
  if (event.startDateTime && event.endDateTime) {
    const start = new Date(event.startDateTime);
    const end = new Date(event.endDateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end.setTime(start.getTime() + 60_000);
    return { startAt: start.toISOString(), endAt: end.toISOString(), allDay: false };
  }
  if (event.startDate && event.endDate) {
    const start = new Date(`${event.startDate}T00:00:00`);
    const end = new Date(`${event.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end <= start) end.setTime(start.getTime() + 24 * 60 * 60 * 1_000);
    return {
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      allDay: true,
    };
  }
  return null;
}

function getInitialSyncRange(now = new Date()) {
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - INITIAL_PAST_DAYS);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + INITIAL_FUTURE_DAYS);
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
}
