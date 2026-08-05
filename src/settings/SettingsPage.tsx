import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getAppSettings, setAppSettings, type AppSettings } from "../data/settings-repository";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleCalendarConnection,
  syncGoogleCalendar,
  type GoogleCalendarConnection,
} from "../data/google-calendar-repository";
import { applyTheme, isThemePreference, type ThemePreference } from "../theme/theme";
import {
  emptySlackConnectionSettings,
  readStoredSlackConnection,
  storeSlackConnection,
  type SlackConnection,
} from "./slack-connection";
import "./SettingsPage.scss";

type SettingsTab = "general" | "jira" | "google" | "slack" | "openai";
type SecretId = "jira_api_token" | "google_client_secret" | "slack_oauth_token" | "openai_api_key";

const tabs: Array<{ id: SettingsTab; label: string; symbol: string }> = [
  { id: "general", label: "일반", symbol: "◐" },
  { id: "jira", label: "Jira", symbol: "J" },
  { id: "google", label: "Google Calendar", symbol: "G" },
  { id: "slack", label: "Slack", symbol: "S" },
  { id: "openai", label: "OpenAI", symbol: "AI" },
];

const secretIds: SecretId[] = [
  "jira_api_token",
  "google_client_secret",
  "slack_oauth_token",
  "openai_api_key",
];

const emptySecretStatus: Record<SecretId, boolean> = {
  jira_api_token: false,
  google_client_secret: false,
  slack_oauth_token: false,
  openai_api_key: false,
};

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
            <span>{tab.symbol}</span>{tab.label}
          </button>
        ))}
      </nav>

      <section className="settings-content">
        {error && <div className="settings-error" role="alert">설정을 처리하지 못했습니다.<small>{error}</small></div>}
        {activeTab === "general" && (
          <GeneralSettings
            theme={isThemePreference(settings.theme) ? settings.theme : "system"}
            onChange={async (theme) => {
              applyTheme(theme);
              updateSetting("theme", theme);
              await saveValues({ theme });
            }}
          />
        )}
        {activeTab === "jira" && (
          <ProviderSettings
            eyebrow="JIRA CLOUD"
            title="Jira 연결"
            description="담당 이슈와 백로그를 Orbit으로 가져오기 위한 계정 정보입니다."
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
        {activeTab === "google" && (
          <GoogleCalendarSettings
            clientId={settings.google_client_id ?? ""}
            isSecretSaved={secretStatus.google_client_secret}
            onClientIdChange={(value) => updateSetting("google_client_id", value)}
            onSave={async (clientId, secret) => {
              await saveValues({ google_client_id: clientId });
              if (secret) await saveSecret("google_client_secret", secret);
            }}
            onError={(cause) => setError(toMessage(cause))}
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
        {activeTab === "openai" && (
          <ProviderSettings
            eyebrow="OPENAI"
            title="OpenAI 연결"
            description="AI 작업 위임과 작업 요약에 사용할 개인 API 설정입니다."
            fields={[
              { key: "openai_model", label: "기본 모델 ID", placeholder: "사용할 모델 ID를 입력하세요", value: settings.openai_model ?? "" },
            ]}
            secretId="openai_api_key"
            secretLabel="API Key"
            secretPlaceholder="sk-…"
            isSecretSaved={secretStatus.openai_api_key}
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
    <div className="security-note"><span>S</span><div><strong>Slack 앱에서 가져오는 값</strong><p>질문에서 추출한 핵심어로 관련 메시지만 검색하며 본문, 채널, 작성자, 시간과 원문 링크를 로컬에 캐시합니다.</p></div></div>
  </div>;
}

function GoogleCalendarSettings({
  clientId,
  isSecretSaved,
  onClientIdChange,
  onSave,
  onError,
}: {
  clientId: string;
  isSecretSaved: boolean;
  onClientIdChange: (value: string) => void;
  onSave: (clientId: string, secret: string) => Promise<void>;
  onError: (cause: unknown) => void;
}) {
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(null);
  const [secret, setSecret] = useState("");
  const [busyAction, setBusyAction] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void getGoogleCalendarConnection().then(setConnection).catch(onError);
  }, []);

  async function run(action: "connect" | "sync" | "disconnect") {
    setBusyAction(action);
    setMessage("");
    try {
      if (action === "disconnect") {
        await disconnectGoogleCalendar();
        setConnection(null);
        setMessage("Google Calendar 연결을 해제했습니다.");
        return;
      }
      if (!clientId.trim()) throw new Error("Google OAuth Client ID를 입력해주세요.");
      await onSave(clientId.trim(), secret.trim());
      setSecret("");
      if (action === "connect") {
        setConnection(await connectGoogleCalendar(clientId.trim()));
        setMessage("계정 연결과 첫 일정 동기화를 완료했습니다.");
      } else {
        setConnection(await syncGoogleCalendar(clientId.trim()));
        setMessage("Google Calendar를 최신 상태로 동기화했습니다.");
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
        <span>GOOGLE OAUTH</span>
        <h2>Google Calendar 연결</h2>
        <p>Google 계정으로 로그인하면 일정 제목, 시간, 장소를 읽기 전용으로 가져옵니다. 수정하거나 삭제하지 않습니다.</p>
      </header>
      <div className="provider-form google-calendar-form">
        <div className="connection-status">
          <span className={connection ? "connected" : ""} />
          <div>
            <strong>{connection ? "Google Calendar 연결됨" : "Google 계정 연결 안 됨"}</strong>
            <small>{connection ? connection.email : "OAuth 클라이언트 정보를 저장한 뒤 로그인하세요"}</small>
          </div>
          {connection?.lastSyncedAt && <time>최근 동기화 {formatSyncTime(connection.lastSyncedAt)}</time>}
        </div>
        <label>OAuth Client ID<input value={clientId} placeholder="…apps.googleusercontent.com" onChange={(event) => onClientIdChange(event.target.value)} /></label>
        <label>OAuth Client Secret <em>선택</em><div className="secret-field"><input type="password" value={secret} autoComplete="off" placeholder={isSecretSaved ? "저장됨 · 변경할 때만 입력" : "Desktop OAuth 시크릿 (선택)"} onChange={(event) => setSecret(event.target.value)} />{isSecretSaved && <span>••••••••</span>}</div></label>
        <p className="secret-help">Google Cloud에서 OAuth 동의 화면과 ‘데스크톱 앱’ 클라이언트를 만든 뒤 입력하세요. 갱신 토큰과 시크릿은 macOS Keychain에만 저장됩니다.</p>
        <div className="provider-actions google-actions">
          {connection && <button type="button" className="danger-button" disabled={busyAction !== null} onClick={() => void run("disconnect")}>{busyAction === "disconnect" ? "해제 중…" : "연결 해제"}</button>}
          <span>{message}</span>
          {connection ? (
            <button type="button" className="primary-button" disabled={busyAction !== null} onClick={() => void run("sync")}>{busyAction === "sync" ? "동기화 중…" : "지금 동기화"}</button>
          ) : (
            <button type="button" className="primary-button" disabled={busyAction !== null || !clientId.trim()} onClick={() => void run("connect")}>{busyAction === "connect" ? "브라우저 로그인 대기 중…" : "Google 계정 연결"}</button>
          )}
        </div>
      </div>
      <div className="security-note"><span>G</span><div><strong>Google Cloud 준비</strong><p>Google Calendar API를 활성화하고 OAuth 클라이언트 유형을 ‘데스크톱 앱’으로 만드세요. 리디렉션은 로그인할 때 Orbit이 localhost 포트를 자동으로 엽니다.</p></div></div>
    </div>
  );
}

function formatSyncTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function GeneralSettings({ theme, onChange }: { theme: ThemePreference; onChange: (theme: ThemePreference) => Promise<void> }) {
  const [isSaving, setIsSaving] = useState(false);
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
                try { await onChange(option.id); } finally { setIsSaving(false); }
              }}
            >
              <span className="theme-preview">{option.preview}</span>
              <strong>{option.label}</strong>
              <em>{theme === option.id ? "선택됨" : ""}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="security-note"><span>⌘</span><div><strong>자격 증명 보안</strong><p>API 키와 토큰은 SQLite나 화면 상태에 보관하지 않고 macOS Keychain에만 저장합니다.</p></div></div>
    </div>
  );
}

type Field = { key: keyof AppSettings; label: string; value: string; placeholder: string; type?: string };

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
    <div className="settings-section">
      <header><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></header>
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
    </div>
  );
}

function toMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
