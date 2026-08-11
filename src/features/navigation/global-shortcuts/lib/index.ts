import { invoke } from "@tauri-apps/api/core";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import type { ShortcutSettings } from "../../../../entities/work-context/model/shortcuts";
import { validateShortcutSettings } from "../../../../entities/work-context/model/shortcuts";

interface ShortcutActions {
  openQuickPanel: () => void;
  openChat: () => void;
}

let actions: ShortcutActions = { openQuickPanel: () => {}, openChat: () => {} };
let registered: ShortcutSettings | null = null;
let updateQueue = Promise.resolve();
let isCapturing = false;

export function setShortcutActions(next: ShortcutActions) {
  actions = next;
}

export function getRegisteredShortcuts(): ShortcutSettings | null {
  return registered ? { ...registered } : null;
}

export function setShortcutCaptureActive(active: boolean) {
  isCapturing = active;
}

export function syncGlobalShortcuts(next: ShortcutSettings): Promise<void> {
  const operation = updateQueue.then(() => replaceShortcuts(next));
  updateQueue = operation.catch(() => {});
  return operation;
}

async function replaceShortcuts(next: ShortcutSettings): Promise<void> {
  const validationError = validateShortcutSettings(next);
  if (validationError) throw new Error(validationError);
  if (registered?.quickPanel === next.quickPanel && registered.chat === next.chat) return;

  const previous = registered;
  if (previous) await unregister([previous.quickPanel, previous.chat]);

  try {
    await register(next.quickPanel, (event) => {
      if (event.state !== "Pressed" || isCapturing) return;
      void invoke("show_main_window").finally(() => actions.openQuickPanel());
    });
    await register(next.chat, (event) => {
      if (event.state !== "Pressed" || isCapturing) return;
      void invoke("show_main_window").finally(() => actions.openChat());
    });
    registered = { ...next };
  } catch (cause) {
    await safeUnregister(next);
    registered = null;
    if (previous) {
      try {
        await register(previous.quickPanel, (event) => {
          if (event.state === "Pressed" && !isCapturing) void invoke("show_main_window").finally(() => actions.openQuickPanel());
        });
        await register(previous.chat, (event) => {
          if (event.state === "Pressed" && !isCapturing) void invoke("show_main_window").finally(() => actions.openChat());
        });
        registered = previous;
      } catch {
        await safeUnregister(previous);
      }
    }
    throw new Error(`단축키를 등록하지 못했습니다. 다른 앱이 이미 사용 중인지 확인해주세요. (${toMessage(cause)})`);
  }
}

async function safeUnregister(settings: ShortcutSettings) {
  for (const shortcut of [settings.quickPanel, settings.chat]) {
    try { await unregister(shortcut); } catch { /* best-effort rollback */ }
  }
}

function toMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
