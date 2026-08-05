use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_sql::{Migration, MigrationKind};

mod github_pull_requests;
mod jira_issue;
mod local_ai_sessions;

const KEYCHAIN_SERVICE: &str = "com.orbit.desktop";

fn validate_secret_id(secret_id: &str) -> Result<(), String> {
    match secret_id {
        "jira_api_token" | "google_client_secret" | "slack_oauth_token" | "openai_api_key" => {
            Ok(())
        }
        _ => Err("지원하지 않는 보안 항목입니다.".into()),
    }
}

fn keychain_entry(secret_id: &str) -> Result<keyring::Entry, String> {
    validate_secret_id(secret_id)?;
    keyring::Entry::new(KEYCHAIN_SERVICE, secret_id).map_err(|error| error.to_string())
}

fn get_secret(secret_id: &str) -> Result<String, String> {
    match keychain_entry(secret_id)?.get_password() {
        Ok(value) if !value.is_empty() => Ok(value),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            Err("저장된 자격 증명이 없습니다. Settings에서 한 번 저장해주세요.".into())
        }
        Err(error) => Err(format!(
            "macOS Keychain에서 자격 증명을 읽지 못했습니다. Orbit의 Keychain 접근을 허용해주세요. ({error})"
        )),
    }
}

#[tauri::command]
fn secret_status(secret_id: String) -> Result<bool, String> {
    let entry = keychain_entry(&secret_id)?;
    match entry.get_password() {
        Ok(value) => Ok(!value.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn set_secret(secret_id: String, value: String) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("비어 있는 값은 저장할 수 없습니다.".into());
    }

    let entry = keychain_entry(&secret_id)?;
    entry
        .set_password(&value)
        .map_err(|error| error.to_string())?;

    match entry.get_password() {
        Ok(saved) if saved == value => Ok(()),
        Ok(_) => Err("Keychain 저장 결과를 검증하지 못했습니다.".into()),
        Err(error) => Err(format!(
            "Keychain에 저장한 값을 다시 읽지 못했습니다. ({error})"
        )),
    }
}

#[tauri::command]
fn delete_secret(secret_id: String) -> Result<(), String> {
    let entry = keychain_entry(&secret_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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

            TrayIconBuilder::with_id("orbit")
                .icon(app.default_window_icon().expect("default app icon").clone())
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
            local_ai_sessions::scan_local_ai_sessions,
            github_pull_requests::scan_session_pull_requests,
            jira_issue::fetch_jira_issue_development,
            jira_issue::fetch_assigned_jira_issues
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
