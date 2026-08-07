use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_sql::{Migration, MigrationKind};

mod codex_auth;
mod confluence;
mod context_discovery;
mod github_pull_requests;
mod google_calendar;
mod jira_issue;
mod jira_transition;
mod local_ai_sessions;
mod openai_chat;
mod slack;
mod task_prioritization;

const KEYCHAIN_SERVICE: &str = "com.orbit.desktop";
static SECRET_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn secret_cache() -> &'static Mutex<HashMap<String, String>> {
    SECRET_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_secret(secret_id: &str) -> Result<Option<String>, String> {
    secret_cache()
        .lock()
        .map(|cache| cache.get(secret_id).cloned())
        .map_err(|_| "자격 증명 메모리 캐시를 읽지 못했습니다.".to_string())
}

fn cache_secret(secret_id: &str, value: &str) -> Result<(), String> {
    secret_cache()
        .lock()
        .map(|mut cache| {
            cache.insert(secret_id.to_owned(), value.to_owned());
        })
        .map_err(|_| "자격 증명 메모리 캐시를 갱신하지 못했습니다.".to_string())
}

fn remove_cached_secret(secret_id: &str) -> Result<(), String> {
    secret_cache()
        .lock()
        .map(|mut cache| {
            cache.remove(secret_id);
        })
        .map_err(|_| "자격 증명 메모리 캐시를 정리하지 못했습니다.".to_string())
}

fn validate_secret_id(secret_id: &str) -> Result<(), String> {
    match secret_id {
        "jira_api_token"
        | "google_client_secret"
        | "google_refresh_token"
        | "slack_oauth_token"
        | "openai_api_key"
        | "claude_api_key"
        | "glm_api_key" => Ok(()),
        _ => Err("지원하지 않는 보안 항목입니다.".into()),
    }
}

fn set_internal_secret(secret_id: &str, value: &str) -> Result<(), String> {
    keychain_entry(secret_id)?
        .set_password(value)
        .map_err(|error| error.to_string())?;
    cache_secret(secret_id, value)
}

fn delete_internal_secret(secret_id: &str) -> Result<(), String> {
    match keychain_entry(secret_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => remove_cached_secret(secret_id),
        Err(error) => Err(error.to_string()),
    }
}

fn keychain_entry(secret_id: &str) -> Result<keyring::Entry, String> {
    validate_secret_id(secret_id)?;
    keyring::Entry::new(KEYCHAIN_SERVICE, secret_id).map_err(|error| error.to_string())
}

fn get_secret(secret_id: &str) -> Result<String, String> {
    validate_secret_id(secret_id)?;
    if let Some(value) = cached_secret(secret_id)? {
        return Ok(value);
    }
    match keychain_entry(secret_id)?.get_password() {
        Ok(value) if !value.is_empty() => {
            cache_secret(secret_id, &value)?;
            Ok(value)
        }
        Ok(_) | Err(keyring::Error::NoEntry) => {
            Err("저장된 자격 증명이 없습니다. Settings에서 한 번 저장해주세요.".into())
        }
        Err(error) => Err(format!(
            "macOS Keychain에서 자격 증명을 읽지 못했습니다. Orbit의 Keychain 접근을 허용해주세요. ({error})"
        )),
    }
}

fn get_optional_secret(secret_id: &str) -> Result<Option<String>, String> {
    validate_secret_id(secret_id)?;
    if let Some(value) = cached_secret(secret_id)? {
        return Ok(Some(value));
    }
    match keychain_entry(secret_id)?.get_password() {
        Ok(value) if !value.is_empty() => {
            cache_secret(secret_id, &value)?;
            Ok(Some(value))
        }
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secret_status(secret_id: String) -> Result<bool, String> {
    validate_secret_id(&secret_id)?;
    if cached_secret(&secret_id)?.is_some() {
        return Ok(true);
    }
    let entry = keychain_entry(&secret_id)?;
    match entry.get_password() {
        Ok(value) if !value.is_empty() => {
            cache_secret(&secret_id, &value)?;
            Ok(true)
        }
        Ok(_) => Ok(false),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn set_secret(secret_id: String, value: String) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("비어 있는 값은 저장할 수 없습니다.".into());
    }

    keychain_entry(&secret_id)?
        .set_password(&value)
        .map_err(|error| error.to_string())?;
    cache_secret(&secret_id, &value)
}

#[tauri::command]
fn delete_secret(secret_id: String) -> Result<(), String> {
    let entry = keychain_entry(&secret_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => remove_cached_secret(&secret_id),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod secret_cache_tests {
    use super::{cache_secret, cached_secret, remove_cached_secret};

    #[test]
    fn reuses_and_removes_cached_credentials() {
        let secret_id = "test_memory_only_secret";
        cache_secret(secret_id, "value").expect("cache secret");
        assert_eq!(
            cached_secret(secret_id).expect("read cache").as_deref(),
            Some("value")
        );
        remove_cached_secret(secret_id).expect("remove cache");
        assert!(cached_secret(secret_id)
            .expect("read empty cache")
            .is_none());
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    if let Some(tray_window) = app.get_webview_window("tray") {
        let _ = tray_window.hide();
    }

    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.unminimize();
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
}

#[tauri::command]
fn hide_tray_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("tray") {
        let _ = window.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_work_items",
            sql: include_str!("../migrations/0001_work_items.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_calendar_events",
            sql: include_str!("../migrations/0002_calendar_events.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_app_settings",
            sql: include_str!("../migrations/0003_app_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_ai_sessions",
            sql: include_str!("../migrations/0004_ai_sessions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_work_item_links",
            sql: include_str!("../migrations/0005_work_item_links.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_session_alias_and_commit_links",
            sql: include_str!("../migrations/0006_session_alias_and_commit_links.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "simplify_task_flow",
            sql: include_str!("../migrations/0007_simplify_task_flow.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_task_delete_cleanup",
            sql: include_str!("../migrations/0008_task_delete_cleanup.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "create_github_pull_request_cache",
            sql: include_str!("../migrations/0009_github_pull_requests.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "scope_pull_requests_to_active_github_user",
            sql: include_str!("../migrations/0010_scope_pull_requests_to_viewer.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "create_jira_issue_cache",
            sql: include_str!("../migrations/0011_jira_issues.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "cache_jira_development_context",
            sql: include_str!("../migrations/0012_jira_development_cache.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "create_google_calendar_sync",
            sql: include_str!("../migrations/0013_google_calendar_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "create_chat_threads",
            sql: include_str!("../migrations/0014_chat_threads.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "cache_slack_message_searches",
            sql: include_str!("../migrations/0015_slack_message_cache.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "cache_confluence_searches",
            sql: include_str!("../migrations/0016_confluence_search_cache.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add_slack_work_item_links",
            sql: include_str!("../migrations/0017_add_slack_work_item_links.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "add_pull_request_viewer_relations",
            sql: include_str!("../migrations/0018_add_pull_request_viewer_relations.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "repair_work_item_delete_trigger",
            sql: include_str!("../migrations/0019_repair_work_item_delete_trigger.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "add_work_item_target_time",
            sql: include_str!("../migrations/0020_add_work_item_target_time.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "create_work_continuity_foundation",
            sql: include_str!("../migrations/0021_work_continuity_foundation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "create_inbox_and_external_actions",
            sql: include_str!("../migrations/0022_inbox_and_external_actions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "create_reviews_templates_automation",
            sql: include_str!("../migrations/0023_reviews_templates_automation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "repair_continuity_focus_protocol",
            sql: include_str!("../migrations/0024_repair_continuity_focus_protocol.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "repair_completion_revision_protocol",
            sql: include_str!("../migrations/0025_repair_completion_revision_protocol.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "execute_automation_actions_safely",
            sql: include_str!("../migrations/0026_automation_execution.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:orbit.db", migrations)
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("tray") {
                let window_to_hide = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Focused(false)) {
                        let _ = window_to_hide.hide();
                    }
                });
            }

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .expect("valid Orbit tray icon");

            TrayIconBuilder::with_id("orbit")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("Orbit · 작업 빠른 보기")
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("tray") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.move_window_constrained(Position::TrayCenter);
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_main_window,
            hide_tray_window,
            secret_status,
            set_secret,
            delete_secret,
            codex_auth::codex_login_status,
            local_ai_sessions::scan_local_ai_sessions,
            context_discovery::rank_task_context,
            github_pull_requests::scan_session_pull_requests,
            jira_issue::fetch_jira_issue_development,
            jira_issue::fetch_assigned_jira_issues,
            jira_transition::preview_jira_status_transition,
            jira_transition::execute_approved_jira_status_transition,
            jira_transition::reconcile_jira_status_transition,
            google_calendar::connect_google_calendar,
            google_calendar::sync_google_calendar,
            google_calendar::disconnect_google_calendar,
            slack::verify_slack_connection,
            slack::search_slack_messages,
            confluence::search_confluence_pages,
            openai_chat::list_openai_chat_models,
            openai_chat::stream_chat_with_orbit_context,
            openai_chat::plan_chat_tools,
            openai_chat::cancel_chat_stream,
            task_prioritization::prioritize_work_items
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
