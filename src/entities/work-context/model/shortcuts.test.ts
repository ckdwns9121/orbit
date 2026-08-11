import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHAT_SHORTCUT,
  DEFAULT_QUICK_PANEL_SHORTCUT,
  displayShortcut,
  isSystemMinimizeShortcut,
  matchesShortcutEvent,
  shortcutFromKeyboardEvent,
  shortcutSettingsFromStored,
  validateShortcutSettings,
} from "./shortcuts";

describe("global shortcut settings", () => {
  test("uses conflict-free defaults", () => {
    expect(shortcutSettingsFromStored({})).toEqual({
      quickPanel: DEFAULT_QUICK_PANEL_SHORTCUT,
      chat: DEFAULT_CHAT_SHORTCUT,
    });
    expect(validateShortcutSettings(shortcutSettingsFromStored({}))).toBeNull();
  });

  test("captures macOS modifier combinations", () => {
    expect(shortcutFromKeyboardEvent({ key: "m", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe("Command+Shift+M");
    expect(shortcutFromKeyboardEvent({ key: "m", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBeNull();
  });

  test("warns about the system minimize shortcut and duplicate actions", () => {
    expect(isSystemMinimizeShortcut("Command+M")).toBe(true);
    expect(validateShortcutSettings({ quickPanel: "Command+K", chat: "Command+K" })).toContain("서로 다른");
    expect(displayShortcut("CommandOrControl+Shift+M")).toBe("⌘ ⇧ M");
  });

  test("matches active-window keyboard events against stored shortcuts", () => {
    expect(matchesShortcutEvent({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, "CommandOrControl+K")).toBe(true);
    expect(matchesShortcutEvent({ key: "m", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, "CommandOrControl+Shift+M")).toBe(true);
    expect(matchesShortcutEvent({ key: "m", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, "CommandOrControl+Shift+M")).toBe(false);
  });
});
