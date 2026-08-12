import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Bot,
  Calendar,
  Command,
  Dumbbell,
  Hash,
  KeyRound,
  Kanban,
  RotateCcw,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { getAppSettings, setAppSettings, type AppSettings } from "../../entities/work-context/api/settings-repository";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleCalendarConnection,
  syncGoogleCalendar,
  type GoogleCalendarConnection,
} from "../../entities/work-context/api/google-calendar-repository";
import { applyTheme, isThemePreference, type ThemePreference } from "../../shared/config/theme/theme";
import {
  emptySlackConnectionSettings,
  readStoredSlackConnection,
  storeSlackConnection,
  type SlackConnection,
} from "./slack-connection";
import "./SettingsPage.scss";
import {
  DEFAULT_CHAT_SHORTCUT,
  DEFAULT_QUICK_PANEL_SHORTCUT,
  displayShortcut,
  isSystemMinimizeShortcut,
  shortcutFromKeyboardEvent,
  shortcutSettingsFromStored,
  validateShortcutSettings,
  type ShortcutSettings,
} from "../../entities/work-context/model/shortcuts";
import {
  getRegisteredShortcuts,
  setShortcutCaptureActive,
  syncGlobalShortcuts,
} from "../../features/navigation/global-shortcuts";
import {
  requestStretchReminderPermission,
  sendStretchReminderNotification,
} from "../../features/wellbeing/stretch-reminders";
import {
  nextStretchReminderAt,
  STRETCH_INTERVAL_OPTIONS,
  stretchReminderPreferencesFromStored,
  type StretchReminderPreferences,
} from "../../entities/work-context/model/stretch-reminder";

type SettingsTab = "general" | "shortcuts" | "jira" | "google" | "slack" | "ai";
type SecretId =
  | "jira_api_token"
  | "slack_oauth_token"
  | "openai_api_key"
  | "claude_api_key"
  | "glm_api_key";

const tabs: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: "general", label: "일반", icon: SlidersHorizontal },
  { id: "shortcuts", label: "단축키", icon: Command },
  { id: "jira", label: "Atlassian", icon: Kanban },
  { id: "google", label: "Google Calendar", icon: Calendar },
  { id: "slack", label: "Slack", icon: Hash },
  { id: "ai", label: "AI", icon: Bot },
];

const secretIds: SecretId[] = [
  "jira_api_token",
  "slack_oauth_token",
  "openai_api_key",
  "claude_api_key",
  "glm_api_key",
];

const emptySecretStatus: Record<SecretId, boolean> = {
  jira_api_token: false,
  slack_oauth_token: false,
  openai_api_key: false,
  claude_api_key: false,
  glm_api_key: false,
};

type CodexLoginStatus = { loggedIn: boolean; authMode: string | null };

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<AppSettings>({ theme: "system" });
  const [secretStatus, setSecretStatus] = useState(emptySecretStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      getAppSettings(),
      Promise.all(secretIds.map(async (id) => [id, await invoke<boolean>("secret_status", { secretId: id })] as const)),
    ])
      .then(([storedSettings, statuses]) => {
        setSettings({ theme: "system", ...storedSettings });
        if (isThemePreference(storedSettings.theme)) applyTheme(storedSettings.theme);
        setSecretStatus(Object.fromEntries(statuses) as Record<SecretId, boolean>);
      })
      .catch((cause) => setError(toMessage(cause)))
      .finally(() => setIsLoading(false));
  }, []);

  function updateSetting(key: keyof AppSettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveValues(values: AppSettings) {
    setError(null);
    try {
      await setAppSettings(values);
      setSettings((current) => ({ ...current, ...values }));
    } catch (cause) {
      setError(toMessage(cause));
      throw cause;
    }
  }

  async function saveSecret(id: SecretId, value: string) {
    await invoke("set_secret", { secretId: id, value });
    setSecretStatus((current) => ({ ...current, [id]: true }));
  }

  async function deleteSecret(id: SecretId) {
    await invoke("delete_secret", { secretId: id });
    setSecretStatus((current) => ({ ...current, [id]: false }));
  }

  if (isLoading) return <div className="settings-loading">설정을 불러오는 중…</div>;

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="설정 분류">
        <div className="settings-nav-heading">설정</div>
        {tabs.map((tab) => (
          <button
            type="button"
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <span><tab.icon size={13} strokeWidth={2} aria-hidden="true" /></span>{tab.label}
          </button>
        ))}
      </nav>

      <section className="settings-content">
        {error && <div className="settings-error" role="alert">설정을 처리하지 못했습니다.<small>{error}</small></div>}
        {activeTab === "general" && (
          <GeneralSettings
            theme={isThemePreference(settings.theme) ? settings.theme : "system"}
            stretchReminder={stretchReminderPreferencesFromStored(settings)}
            onThemeChange={async (theme) => {
              applyTheme(theme);
              updateSetting("theme", theme);
              await saveValues({ theme });
            }}
            onStretchReminderChange={async (preferences) => {
              const values: AppSettings = {
                stretch_reminder_enabled: String(preferences.enabled),
                stretch_reminder_interval_minutes: String(preferences.intervalMinutes),
                stretch_reminder_next_at: preferences.nextAt ?? "",
              };
              await saveValues(values);
            }}
          />
        )}
        {activeTab === "jira" && (
          <ProviderSettings
            eyebrow="ATLASSIAN CLOUD"
            title="Jira · Confluence 연결"
            description="담당 Jira 이슈와 권한이 있는 Confluence 문서를 Orbit으로 가져옵니다. 두 서비스는 같은 Atlassian 계정 정보를 사용합니다."
            fields={[
              { key: "jira_url", label: "사이트 URL", placeholder: "https://team.atlassian.net", value: settings.jira_url ?? "" },
              { key: "jira_email", label: "계정 이메일", placeholder: "name@company.com", value: settings.jira_email ?? "", type: "email" },
            ]}
            secretId="jira_api_token"
            secretLabel="API 토큰"
            secretPlaceholder="Atlassian API 토큰"
            isSecretSaved={secretStatus.jira_api_token}
            onFieldChange={updateSetting}
            onSave={saveValues}
            onSaveSecret={saveSecret}
            onDeleteSecret={deleteSecret}
          />
        )}
        {activeTab === "shortcuts" && (
          <ShortcutSettingsSection
            initial={shortcutSettingsFromStored(settings)}
            onSave={async (next) => {
              const previous = getRegisteredShortcuts();
              await syncGlobalShortcuts(next);
              try {
                await saveValues({ quick_panel_shortcut: next.quickPanel, chat_shortcut: next.chat });
              } catch (cause) {
                if (previous) await syncGlobalShortcuts(previous);
                throw cause;
              }
            }}
          />
        )}
        {activeTab === "google" && (
          <GoogleCalendarSettings
            onError={(cause) => setError(toMessage(cause))}
            onClearError={() => setError(null)}
          />
        )}
        {activeTab === "slack" && (
          <SlackSettings
            isSecretSaved={secretStatus.slack_oauth_token}
            storedConnection={readStoredSlackConnection(settings)}
            onSaveToken={async (token) => saveSecret("slack_oauth_token", token)}
            onVerified={async (connection) => saveValues(storeSlackConnection(connection))}
            onDisconnect={async () => {
              await deleteSecret("slack_oauth_token");
              await saveValues(emptySlackConnectionSettings);
            }}
            onError={(cause) => setError(toMessage(cause))}
          />
        )}
        {activeTab === "ai" && (
          <AiSettings
            settings={settings}
            secretStatus={secretStatus}
            onFieldChange={updateSetting}
            onSave={saveValues}
            onSaveSecret={saveSecret}
            onDeleteSecret={deleteSecret}
          />
        )}
      </section>
    </div>
  );
}

function ShortcutSettingsSection({ initial, onSave }: { initial: ShortcutSettings; onSave: (next: ShortcutSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmSystemConflict, setConfirmSystemConflict] = useState(false);

  async function save(explicitConflictConfirmation = false) {
    const validationError = validateShortcutSettings(draft);
    if (validationError) { setLocalError(validationError); return; }
    if ((isSystemMinimizeShortcut(draft.quickPanel) || isSystemMinimizeShortcut(draft.chat)) && !explicitConflictConfirmation) {
      setConfirmSystemConflict(true);
      return;
    }

    setIsSaving(true);
    setSaved(false);
    setLocalError(null);
    try {
      await onSave(draft);
      setSaved(true);
      setConfirmSystemConflict(false);
    } catch (cause) {
      setLocalError(toMessage(cause));
    } finally {
      setIsSaving(false);
    }
  }

  function resetDefaults() {
    setDraft({ quickPanel: DEFAULT_QUICK_PANEL_SHORTCUT, chat: DEFAULT_CHAT_SHORTCUT });
    setConfirmSystemConflict(false);
    setSaved(false);
    setLocalError(null);
  }

  return (
    <div className="settings-section">
      <header><span>KEYBOARD</span><h2>전역 단축키</h2><p>Orbit이 백그라운드에 있어도 빠른 작업 패널이나 Chat을 바로 엽니다. 입력란을 선택한 뒤 원하는 조합을 누르세요.</p></header>
      <div className="settings-card shortcut-settings-card">
        <ShortcutRecorder
          label="Task quick panel"
          description="메인 창을 앞으로 가져오고 오늘 할 일 패널을 엽니다."
          value={draft.quickPanel}
          onChange={(quickPanel) => { setDraft((current) => ({ ...current, quickPanel })); setSaved(false); setConfirmSystemConflict(false); }}
        />
        <ShortcutRecorder
          label="Chat"
          description="메인 창을 열고 Chat 섹션으로 이동합니다."
          value={draft.chat}
          onChange={(chat) => { setDraft((current) => ({ ...current, chat })); setSaved(false); setConfirmSystemConflict(false); }}
        />

        {(isSystemMinimizeShortcut(draft.quickPanel) || isSystemMinimizeShortcut(draft.chat)) && (
          <div className="shortcut-warning" role="alert">
            <strong>⌘ M은 macOS 창 최소화 단축키입니다.</strong>
            <span>Orbit 단축키가 시스템 동작보다 먼저 처리되거나 앱에 따라 충돌할 수 있습니다. 이 조합을 유지하려면 아래에서 명시적으로 확인해주세요.</span>
          </div>
        )}
        {localError && <div className="shortcut-inline-error" role="alert">{localError}</div>}

        <div className="shortcut-actions">
          <button type="button" onClick={resetDefaults}><RotateCcw size={13} strokeWidth={1.8} /> 기본값 복원</button>
          {saved && <span>저장됨</span>}
          {confirmSystemConflict ? (
            <>
              <button type="button" onClick={() => setConfirmSystemConflict(false)}>취소</button>
              <button className="danger-button" type="button" disabled={isSaving} onClick={() => void save(true)}>⌘ M 충돌을 이해하고 설정</button>
            </>
          ) : (
            <button className="primary-button" type="button" disabled={isSaving} onClick={() => void save()}>{isSaving ? "등록 중…" : "단축키 저장"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ShortcutRecorder({ label, description, value, onChange }: { label: string; description: string; value: string; onChange: (value: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => () => setShortcutCaptureActive(false), []);

  return (
    <div className={`shortcut-recorder ${isRecording ? "recording" : ""}`}>
      <div><strong>{label}</strong><span>{description}</span></div>
      <button
        type="button"
        aria-label={`${label} 단축키. 현재 ${displayShortcut(value)}`}
        onFocus={() => { setIsRecording(true); setShortcutCaptureActive(true); }}
        onBlur={() => { setIsRecording(false); setShortcutCaptureActive(false); }}
        onKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
          if (shortcut) onChange(shortcut);
        }}
      >
        <kbd>{displayShortcut(value)}</kbd>
        <small>{isRecording ? "새 조합을 누르세요" : "변경"}</small>
      </button>
    </div>
  );
}

function SlackSettings({ isSecretSaved, storedConnection, onSaveToken, onVerified, onDisconnect, onError }: {
  isSecretSaved: boolean;
  storedConnection: SlackConnection | null;
  onSaveToken: (token: string) => Promise<void>;
  onVerified: (connection: SlackConnection) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onError: (cause: unknown) => void;
}) {
  const [token, setToken] = useState("");
  const [connection, setConnection] = useState<SlackConnection | null>(storedConnection);
  const [isBusy, setIsBusy] = useState(false);

  async function verify() {
    setIsBusy(true);
    try {
      if (token.trim()) { await onSaveToken(token.trim()); setToken(""); }
      const verified = await invoke<SlackConnection>("verify_slack_connection");
      await onVerified(verified);
      setConnection(verified);
    } catch (cause) { onError(cause); } finally { setIsBusy(false); }
  }

  return <div className="settings-section">
    <header><span>SLACK</span><h2>Slack 연결</h2><p>Slack User OAuth 토큰으로 워크스페이스를 연결하고 Chat 질문과 관련된 메시지를 검색합니다.</p></header>
    <div className="provider-form">
      <div className="connection-status"><span className={connection ? "connected" : ""} /><div><strong>{connection ? "Slack 연결됨" : isSecretSaved ? "토큰 저장됨 · 연결 확인 필요" : "Slack 연결 안 됨"}</strong><small>{connection ? `${connection.workspaceName} · ${connection.userName}` : "Slack 앱의 OAuth 토큰을 입력하세요"}</small></div></div>
      <label>OAuth 토큰<div className="secret-field"><input type="password" value={token} autoComplete="off" placeholder={isSecretSaved ? "저장됨 · 새 토큰으로 변경할 때만 입력" : "xoxp-… 또는 xoxb-…"} onChange={(event) => setToken(event.target.value)} />{isSecretSaved && <span>••••••••</span>}</div></label>
      <p className="secret-help">전체 대화 접근에는 xoxp- User OAuth Token과 search:read 범위가 필요합니다. 검색 결과는 10분 동안 로컬 캐시를 사용합니다.</p>
      <div className="provider-actions">
        {isSecretSaved && <button type="button" className="danger-button" onClick={async () => { await onDisconnect(); setConnection(null); }}>연결 해제</button>}
        <span>{connection ? `Workspace ID ${connection.workspaceId}` : ""}</span>
        <button type="button" className="primary-button" disabled={isBusy || (!token.trim() && !isSecretSaved)} onClick={() => void verify()}>{isBusy ? "확인 중…" : token.trim() ? "토큰 저장 후 연결" : "연결 확인"}</button>
      </div>
    </div>
    <div className="security-note"><span><Hash size={15} strokeWidth={1.8} aria-hidden="true" /></span><div><strong>Slack 앱에서 가져오는 값</strong><p>질문에서 추출한 핵심어로 관련 메시지만 검색하며 본문, 채널, 작성자, 시간과 원문 링크를 로컬에 캐시합니다.</p></div></div>
  </div>;
}

function GoogleCalendarSettings({
  onError,
  onClearError,
}: {
  onError: (cause: unknown) => void;
  onClearError: () => void;
}) {
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(null);
  const [isConnectionLoading, setIsConnectionLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void getGoogleCalendarConnection().then(setConnection).catch(onError).finally(() => setIsConnectionLoading(false));
  }, []);

  async function run(action: "connect" | "sync" | "disconnect") {
    setBusyAction(action);
    setMessage("");
    onClearError();
    try {
      if (action === "disconnect") {
        await disconnectGoogleCalendar();
        setConnection(null);
        setMessage("Google Calendar 연결을 해제했습니다.");
        return;
      }
      if (action === "connect") {
        setConnection(await connectGoogleCalendar());
        setMessage("Google 계정을 연결하고 일정을 동기화했습니다.");
      } else {
        setConnection(await syncGoogleCalendar());
        setMessage("일정을 최신 상태로 동기화했습니다.");
      }
    } catch (cause) {
      const storedConnection = await getGoogleCalendarConnection().catch(() => null);
      if (storedConnection) setConnection(storedConnection);
      onError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="settings-section">
      <header>
        <span>GOOGLE CALENDAR</span>
        <h2>Google Calendar</h2>
        <p>Google 계정을 연결하면 일정 제목, 시간, 장소를 Orbit으로 가져옵니다. Orbit에서는 Google 일정을 수정하거나 삭제하지 않습니다.</p>
      </header>
      <div className="provider-form google-calendar-form" aria-busy={busyAction !== null || isConnectionLoading}>
        <div className="connection-status">
          <span className={connection ? "connected" : ""} aria-hidden="true" />
          <div>
            <strong>{isConnectionLoading ? "연결 상태 확인 중" : connection ? "Google Calendar 연결됨" : "연결된 Google 계정 없음"}</strong>
            <small>{connection ? connection.email : "브라우저에서 Google 계정에 로그인해 연결하세요."}</small>
          </div>
          {connection?.lastSyncedAt && <time dateTime={connection.lastSyncedAt}>최근 동기화 {formatSyncTime(connection.lastSyncedAt)}</time>}
        </div>
        <div className="provider-actions google-actions">
          {connection && <button type="button" className="danger-button" disabled={busyAction !== null || isConnectionLoading} onClick={() => void run("disconnect")}>{busyAction === "disconnect" ? "해제 중…" : "연결 해제"}</button>}
          <span role="status" aria-live="polite">{message}</span>
          {connection ? (
            <button type="button" className="primary-button" disabled={busyAction !== null || isConnectionLoading} onClick={() => void run("sync")}>{busyAction === "sync" ? "동기화 중…" : "지금 동기화"}</button>
          ) : (
            <button type="button" className="primary-button" disabled={busyAction !== null || isConnectionLoading} onClick={() => void run("connect")}>{busyAction === "connect" ? "브라우저에서 로그인하는 중…" : "Google 계정 연결"}</button>
          )}
        </div>
      </div>
      <div className="security-note"><span><KeyRound size={15} strokeWidth={1.8} aria-hidden="true" /></span><div><strong>읽기 전용으로 안전하게 연결</strong><p>로그인은 기본 브라우저에서 진행되며 갱신 토큰은 이 Mac의 Keychain에만 저장됩니다. 연결을 해제하면 Orbit에 저장된 로그인 정보와 Google 일정 캐시가 삭제되고, Google Calendar 원본은 변경되지 않습니다.</p></div></div>
    </div>
  );
}

function formatSyncTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function GeneralSettings({
  theme,
  stretchReminder,
  onThemeChange,
  onStretchReminderChange,
}: {
  theme: ThemePreference;
  stretchReminder: StretchReminderPreferences;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onStretchReminderChange: (preferences: StretchReminderPreferences) => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [isReminderSaving, setIsReminderSaving] = useState(false);
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const options: Array<{ id: ThemePreference; label: string; preview: ReactNode }> = [
    { id: "system", label: "시스템 설정", preview: <><i /><i className="dark" /></> },
    { id: "light", label: "라이트", preview: <i /> },
    { id: "dark", label: "다크", preview: <i className="dark" /> },
  ];

  return (
    <div className="settings-section">
      <header><span>GENERAL</span><h2>일반 설정</h2><p>Orbit의 화면 모양과 기본 동작을 설정합니다.</p></header>
      <div className="settings-card">
        <div className="settings-card-title"><strong>테마</strong><span>변경 즉시 모든 화면에 적용됩니다.</span></div>
        <div className="theme-options">
          {options.map((option) => (
            <button
              type="button"
              className={theme === option.id ? "active" : ""}
              key={option.id}
              disabled={isSaving}
              onClick={async () => {
                setIsSaving(true);
                try { await onThemeChange(option.id); } finally { setIsSaving(false); }
              }}
            >
              <span className="theme-preview">{option.preview}</span>
              <strong>{option.label}</strong>
              <em>{theme === option.id ? "선택됨" : ""}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-card stretch-reminder-card" aria-busy={isReminderSaving}>
        <div className="stretch-reminder-heading">
          <span><Dumbbell size={17} strokeWidth={1.8} aria-hidden="true" /></span>
          <div><strong>스트레칭 알림</strong><small>Orbit이 실행 중일 때 일정한 간격으로 Mac 알림을 보냅니다.</small></div>
          <label className="settings-switch">
            <span className="sr-only">스트레칭 알림 사용</span>
            <input
              type="checkbox"
              checked={stretchReminder.enabled}
              disabled={isReminderSaving}
              onChange={async (event) => {
                const enabled = event.target.checked;
                setIsReminderSaving(true);
                setReminderMessage(null);
                try {
                  if (enabled && !(await requestStretchReminderPermission())) {
                    setReminderMessage("macOS 알림 권한을 허용해야 스트레칭 알림을 받을 수 있어요.");
                    return;
                  }
                  await onStretchReminderChange({
                    ...stretchReminder,
                    enabled,
                    nextAt: enabled ? nextStretchReminderAt(new Date(), stretchReminder.intervalMinutes) : null,
                  });
                  setReminderMessage(enabled ? "스트레칭 알림을 시작했어요." : "스트레칭 알림을 껐어요.");
                } catch (cause) {
                  setReminderMessage(toMessage(cause));
                } finally {
                  setIsReminderSaving(false);
                }
              }}
            />
            <i aria-hidden="true" />
          </label>
        </div>
        <div className="stretch-reminder-controls">
          <label>
            <span>알림 주기</span>
            <select
              value={stretchReminder.intervalMinutes}
              disabled={isReminderSaving}
              onChange={async (event) => {
                const intervalMinutes = Number(event.target.value);
                setIsReminderSaving(true);
                setReminderMessage(null);
                try {
                  await onStretchReminderChange({
                    ...stretchReminder,
                    intervalMinutes,
                    nextAt: stretchReminder.enabled ? nextStretchReminderAt(new Date(), intervalMinutes) : null,
                  });
                  setReminderMessage(`${intervalMinutes}분 간격으로 저장했어요.`);
                } catch (cause) {
                  setReminderMessage(toMessage(cause));
                } finally {
                  setIsReminderSaving(false);
                }
              }}
            >
              {STRETCH_INTERVAL_OPTIONS.map((minutes) => <option value={minutes} key={minutes}>{minutes}분마다</option>)}
            </select>
          </label>
          <div className="stretch-reminder-next">
            <span>다음 알림</span>
            <strong>{stretchReminder.enabled && stretchReminder.nextAt ? formatReminderTime(stretchReminder.nextAt) : "사용 안 함"}</strong>
          </div>
          <button
            type="button"
            disabled={isReminderSaving}
            onClick={async () => {
              setReminderMessage(null);
              if (!(await requestStretchReminderPermission())) {
                setReminderMessage("macOS 알림 권한을 허용해주세요.");
                return;
              }
              sendStretchReminderNotification(true);
              setReminderMessage("테스트 알림을 보냈어요.");
            }}
          >테스트 알림</button>
        </div>
        <p className="stretch-reminder-status" role="status" aria-live="polite">{reminderMessage}</p>
      </div>
      <div className="security-note"><span><KeyRound size={15} strokeWidth={1.8} aria-hidden="true" /></span><div><strong>자격 증명 보안</strong><p>API 키와 토큰은 입력 중에만 폼에 존재하며, 저장할 때 SQLite가 아닌 macOS Keychain으로 전달됩니다.</p></div></div>
    </div>
  );
}

function formatReminderTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

type Field = { key: keyof AppSettings; label: string; value: string; placeholder: string; type?: string };

const aiProviders: Array<{ id: "openai" | "claude" | "glm"; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "claude", label: "Claude" },
  { id: "glm", label: "GLM" },
];

function AiSettings({
  settings, secretStatus, onFieldChange, onSave, onSaveSecret, onDeleteSecret,
}: {
  settings: AppSettings;
  secretStatus: Record<SecretId, boolean>;
  onFieldChange: (key: keyof AppSettings, value: string) => void;
  onSave: (settings: AppSettings) => Promise<void>;
  onSaveSecret: (id: SecretId, value: string) => Promise<void>;
  onDeleteSecret: (id: SecretId) => Promise<void>;
}) {
  const [provider, setProvider] = useState<"openai" | "claude" | "glm">("openai");
  const [codexStatus, setCodexStatus] = useState<CodexLoginStatus | null>(null);

  useEffect(() => {
    void invoke<CodexLoginStatus>("codex_login_status").then(setCodexStatus).catch(() => setCodexStatus(null));
  }, []);

  return (
    <div className="settings-section">
      <header>
        <span>AI</span>
        <h2>AI 연결</h2>
        <p>Chat과 컨텍스트 분석에 사용할 모델 제공자별 인증 정보를 관리합니다. 입력한 API Key는 macOS Keychain에만 저장됩니다.</p>
      </header>
      <div className="ai-provider-tabs" role="tablist" aria-label="AI 제공자 선택">
        {aiProviders.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            aria-selected={provider === item.id}
            className={provider === item.id ? "active" : ""}
            onClick={() => setProvider(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {provider === "openai" && (
        <>
          <ProviderCredentialForm
            key="openai"
            fields={[]}
            secretId="openai_api_key"
            secretLabel="API Key"
            secretPlaceholder="sk-…"
            isSecretSaved={secretStatus.openai_api_key}
            onFieldChange={onFieldChange}
            onSave={onSave}
            onSaveSecret={onSaveSecret}
            onDeleteSecret={onDeleteSecret}
          />
          <div className="security-note">
            <span><Terminal size={15} strokeWidth={1.8} aria-hidden="true" /></span>
            <div>
              <strong>{codexStatus?.loggedIn && codexStatus.authMode === "chatgpt" ? "Codex · ChatGPT OAuth 연결됨" : "OpenAI API와 Codex 로그인"}</strong>
              <p>
                Orbit의 OpenAI API 호출은 공식 API Key 인증을 사용합니다. ChatGPT OAuth는 Codex CLI에 한해 로그인 상태를 확인하며, Orbit이 해당 토큰을 읽거나 API Key 대신 재사용하지 않습니다.
                {" "}
                {codexStatus?.loggedIn
                  ? `이 기기의 Codex CLI는 현재 ${codexStatus.authMode === "chatgpt" ? "ChatGPT 계정으로" : codexStatus.authMode === "api_key" ? "API Key로" : "로그인된 상태로"} 감지되었습니다. Codex CLI 로그인 연동은 추후 지원할 예정이며, 그 자격 증명을 Orbit이 가져오지는 않습니다.`
                  : "이 기기에서 Codex CLI 로그인 상태는 감지되지 않았습니다. OpenAI 기능은 위 API Key를 사용해 주세요."}
              </p>
            </div>
          </div>
        </>
      )}

      {provider === "claude" && (
        <ProviderCredentialForm
          key="claude"
          fields={[]}
          secretId="claude_api_key"
          secretLabel="API Key"
          secretPlaceholder="sk-ant-…"
          isSecretSaved={secretStatus.claude_api_key}
          onFieldChange={onFieldChange}
          onSave={onSave}
          onSaveSecret={onSaveSecret}
          onDeleteSecret={onDeleteSecret}
        />
      )}

      {provider === "glm" && (
        <ProviderCredentialForm
          key="glm"
          fields={[{
            key: "glm_base_url",
            label: "API Base URL",
            value: settings.glm_base_url ?? "",
            placeholder: "https://api.z.ai/api/paas/v4",
          }]}
          secretId="glm_api_key"
          secretLabel="API Key"
          secretPlaceholder="GLM API Key"
          isSecretSaved={secretStatus.glm_api_key}
          onFieldChange={onFieldChange}
          onSave={onSave}
          onSaveSecret={onSaveSecret}
          onDeleteSecret={onDeleteSecret}
        />
      )}

      <div className="security-note">
        <span><KeyRound size={15} strokeWidth={1.8} aria-hidden="true" /></span>
        <div><strong>자격 증명 보안</strong><p>API 키는 입력 중에만 폼에 존재하며, 저장할 때 SQLite가 아닌 macOS Keychain으로 전달됩니다. 저장 후에는 값이 화면으로 다시 전달되지 않습니다.</p></div>
      </div>
    </div>
  );
}

function ProviderSettings({
  eyebrow, title, description, fields, secretId, secretLabel, secretPlaceholder, isSecretSaved,
  onFieldChange, onSave, onSaveSecret, onDeleteSecret,
}: {
  eyebrow: string; title: string; description: string; fields: Field[]; secretId: SecretId;
  secretLabel: string; secretPlaceholder: string; isSecretSaved: boolean;
  onFieldChange: (key: keyof AppSettings, value: string) => void;
  onSave: (settings: AppSettings) => Promise<void>;
  onSaveSecret: (id: SecretId, value: string) => Promise<void>;
  onDeleteSecret: (id: SecretId) => Promise<void>;
}) {
  return (
    <div className="settings-section">
      <header><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></header>
      <ProviderCredentialForm
        fields={fields}
        secretId={secretId}
        secretLabel={secretLabel}
        secretPlaceholder={secretPlaceholder}
        isSecretSaved={isSecretSaved}
        onFieldChange={onFieldChange}
        onSave={onSave}
        onSaveSecret={onSaveSecret}
        onDeleteSecret={onDeleteSecret}
      />
    </div>
  );
}

function ProviderCredentialForm({
  fields, secretId, secretLabel, secretPlaceholder, isSecretSaved,
  onFieldChange, onSave, onSaveSecret, onDeleteSecret,
}: {
  fields: Field[]; secretId: SecretId;
  secretLabel: string; secretPlaceholder: string; isSecretSaved: boolean;
  onFieldChange: (key: keyof AppSettings, value: string) => void;
  onSave: (settings: AppSettings) => Promise<void>;
  onSaveSecret: (id: SecretId, value: string) => Promise<void>;
  onDeleteSecret: (id: SecretId) => Promise<void>;
}) {
  const [secret, setSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setSaved(false);
    try {
      await onSave(Object.fromEntries(fields.map((field) => [field.key, field.value])) as AppSettings);
      if (secret.trim()) {
        await onSaveSecret(secretId, secret.trim());
        setSecret("");
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="connection-status">
        <span className={isSecretSaved ? "connected" : ""} />
        <div><strong>{isSecretSaved ? "자격 증명 저장됨" : "연결 정보 없음"}</strong><small>{isSecretSaved ? "Keychain에서 안전하게 관리 중" : "필수 정보를 입력해 주세요"}</small></div>
      </div>
      {fields.map((field) => (
        <label key={field.key}>{field.label}<input type={field.type ?? "text"} value={field.value} placeholder={field.placeholder} onChange={(event) => onFieldChange(field.key, event.target.value)} /></label>
      ))}
      <label>{secretLabel}<div className="secret-field"><input type="password" value={secret} autoComplete="off" placeholder={isSecretSaved ? "새 값으로 변경하려면 입력" : secretPlaceholder} onChange={(event) => setSecret(event.target.value)} />{isSecretSaved && <span>••••••••</span>}</div></label>
      <p className="secret-help">저장 후에는 값이 화면으로 다시 전달되지 않습니다.</p>
      <div className="provider-actions">
        {isSecretSaved && <button type="button" className="danger-button" onClick={() => onDeleteSecret(secretId)}>자격 증명 삭제</button>}
        <span>{saved ? "저장되었습니다" : ""}</span>
        <button type="submit" className="primary-button" disabled={isSaving}>{isSaving ? "저장 중…" : "설정 저장"}</button>
      </div>
    </form>
  );
}

function toMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
