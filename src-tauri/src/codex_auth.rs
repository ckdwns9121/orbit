use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStatus {
    pub logged_in: bool,
    pub auth_mode: Option<String>,
}

/// Surfaces the installed Codex CLI login status without opening or parsing its
/// credential file. Orbit never receives a Codex access token from this command.
#[tauri::command]
pub fn codex_login_status() -> CodexLoginStatus {
    let not_logged_in = CodexLoginStatus {
        logged_in: false,
        auth_mode: None,
    };

    // GUI apps have a minimal PATH on macOS; a login shell resolves the user's
    // actual Codex installation (Homebrew, npm, nvm, etc.).
    let Ok(output) = Command::new("/bin/zsh")
        .args(["-lc", "codex login status"])
        .output()
    else {
        return not_logged_in;
    };
    if !output.status.success() {
        return not_logged_in;
    }

    let status = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .to_lowercase();
    let auth_mode = if status.contains("chatgpt") {
        Some("chatgpt".to_string())
    } else if status.contains("api key") || status.contains("api_key") {
        Some("api_key".to_string())
    } else {
        Some("unknown".to_string())
    };

    CodexLoginStatus {
        logged_in: true,
        auth_mode,
    }
}
