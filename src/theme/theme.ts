export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "orbit-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredTheme(): ThemePreference {
  const value = localStorage.getItem(STORAGE_KEY);
  return isThemePreference(value) ? value : "system";
}

export function applyTheme(theme: ThemePreference): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}
