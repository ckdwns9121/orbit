import Database from "@tauri-apps/plugin-sql";

const DATABASE_URL = "sqlite:orbit.db";

let databasePromise: Promise<Database> | undefined;

export function getDatabase(): Promise<Database> {
  databasePromise ??= Database.load(DATABASE_URL);
  return databasePromise;
}
