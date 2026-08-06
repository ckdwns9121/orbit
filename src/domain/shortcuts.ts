export const DEFAULT_QUICK_PANEL_SHORTCUT = "CommandOrControl+K";
export const DEFAULT_CHAT_SHORTCUT = "CommandOrControl+Shift+M";

export interface ShortcutSettings {
  quickPanel: string;
  chat: string;
}

export function shortcutSettingsFromStored(settings: {
  quick_panel_shortcut?: string;
  chat_shortcut?: string;
}): ShortcutSettings {
  return {
    quickPanel: settings.quick_panel_shortcut?.trim() || DEFAULT_QUICK_PANEL_SHORTCUT,
    chat: settings.chat_shortcut?.trim() || DEFAULT_CHAT_SHORTCUT,
  };
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  const key = normalizeKey(event.key);
  if (!key || ["Meta", "Control", "Alt", "Shift"].includes(key)) return null;

  const modifiers = [
    event.metaKey ? "Command" : null,
    event.ctrlKey ? "Control" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
  ].filter(Boolean);
  if (modifiers.length === 0) return null;
  return [...modifiers, key].join("+");
}

export function validateShortcutSettings(settings: ShortcutSettings): string | null {
  if (!settings.quickPanel || !settings.chat) return "두 단축키를 모두 입력해주세요.";
  if (canonicalShortcut(settings.quickPanel) === canonicalShortcut(settings.chat)) {
    return "Task quick panel과 Chat에 서로 다른 단축키를 지정해주세요.";
  }
  return null;
}

export function isSystemMinimizeShortcut(shortcut: string): boolean {
  return canonicalShortcut(shortcut) === "commandm" || canonicalShortcut(shortcut) === "commandorcontrolm";
}

export function displayShortcut(shortcut: string): string {
  return shortcut
    .replace("CommandOrControl", "⌘")
    .replace("Command", "⌘")
    .replace("Control", "⌃")
    .replace("Alt", "⌥")
    .replace("Shift", "⇧")
    .replace(/\+/g, " ");
}

export function matchesShortcutEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  shortcut: string,
): boolean {
  const tokens = shortcut.toLowerCase().split("+").map((token) => token.trim()).filter(Boolean);
  const expectsMeta = tokens.includes("command") || tokens.includes("commandorcontrol");
  const expectsControl = tokens.includes("control");
  const acceptsPlatformModifier = tokens.includes("commandorcontrol");
  const expectedKey = tokens.find((token) => !["command", "commandorcontrol", "control", "alt", "shift"].includes(token));
  if (!expectedKey) return false;
  if (acceptsPlatformModifier ? !(event.metaKey || event.ctrlKey) : event.metaKey !== expectsMeta || event.ctrlKey !== expectsControl) return false;
  if (event.altKey !== tokens.includes("alt") || event.shiftKey !== tokens.includes("shift")) return false;
  return normalizeKey(event.key)?.toLowerCase() === expectedKey;
}

function canonicalShortcut(shortcut: string): string {
  return shortcut.toLowerCase().replace(/\s|\+/g, "");
}

function normalizeKey(key: string): string | null {
  if (key === " ") return "Space";
  if (key === "Escape") return "Escape";
  if (key === "Enter") return "Enter";
  if (key === "Backspace") return "Backspace";
  if (key === "Delete") return "Delete";
  if (key === "Tab") return "Tab";
  if (/^Arrow(Up|Down|Left|Right)$/.test(key)) return key.replace("Arrow", "");
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  return null;
}
