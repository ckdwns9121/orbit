import { getDatabase } from "./database";

export type SettingKey =
  | "theme"
  | "jira_url"
  | "jira_email"
  | "google_client_id"
  | "slack_workspace"
  | "slack_workspace_id"
  | "slack_user_name"
  | "slack_user_id"
  | "openai_model"
  | "glm_base_url"
  | "quick_panel_shortcut"
  | "chat_shortcut";

export type AppSettings = Partial<Record<SettingKey, string>>;

type SettingRow = { key: SettingKey; value: string };

export async function getAppSettings(): Promise<AppSettings> {
  const database = await getDatabase();
  const rows = await database.select<SettingRow[]>("SELECT key, value FROM app_settings");
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as AppSettings;
}

export async function setAppSettings(settings: AppSettings): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();

  await Promise.all(
    Object.entries(settings).map(([key, value]) =>
      database.execute(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value ?? "", now],
      ),
    ),
  );
}
