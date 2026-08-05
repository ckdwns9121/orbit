import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getAppSettings, setAppSettings, type AppSettings } from "../data/settings-repository";
import { applyTheme, isThemePreference, type ThemePreference } from "../theme/theme";
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
          <ProviderSettings
            eyebrow="GOOGLE OAUTH"
            title="Google Calendar 연결"
            description="Google Calendar는 일반 API 키가 아니라 OAuth 클라이언트 정보로 연결합니다. 실제 Google 로그인 연결은 다음 연동 단계에서 추가할 수 있어요."
            fields={[
              { key: "google_client_id", label: "OAuth Client ID", placeholder: "…apps.googleusercontent.com", value: settings.google_client_id ?? "" },
            ]}
            secretId="google_client_secret"
            secretLabel="OAuth Client Secret"
            secretPlaceholder="Google OAuth 클라이언트 시크릿"
            isSecretSaved={secretStatus.google_client_secret}
            onFieldChange={updateSetting}
            onSave={saveValues}
            onSaveSecret={saveSecret}
            onDeleteSecret={deleteSecret}
          />
        )}
        {activeTab === "slack" && (
          <ProviderSettings
            eyebrow="SLACK"
            title="Slack 연결"
            description="멘션과 확인할 메시지를 가져올 Slack 앱의 OAuth 토큰을 저장합니다."
            fields={[
              { key: "slack_workspace", label: "워크스페이스", placeholder: "예: orbit-team", value: settings.slack_workspace ?? "" },
            ]}
            secretId="slack_oauth_token"
            secretLabel="OAuth 토큰"
            secretPlaceholder="xoxb-… 또는 xoxp-…"
            isSecretSaved={secretStatus.slack_oauth_token}
            onFieldChange={updateSetting}
            onSave={saveValues}
            onSaveSecret={saveSecret}
            onDeleteSecret={deleteSecret}
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
