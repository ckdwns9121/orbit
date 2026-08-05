use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_FILES: usize = 300;
const MAX_LINES_PER_FILE: usize = 50_000;
const MAX_PREVIEW_CHARS: usize = 600;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiSession {
    pub provider: String,
    pub session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub modified_at_ms: u64,
    pub message_count: u32,
}

#[derive(Debug, Default)]
struct SessionDraft {
    session_id: String,
    title: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    first_prompt: Option<String>,
    last_prompt: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    message_count: u32,
    rejected: bool,
}

#[derive(Debug)]
struct Candidate {
    provider: &'static str,
    path: PathBuf,
    modified_at_ms: u64,
}

#[tauri::command]
pub async fn scan_local_ai_sessions() -> Result<Vec<LocalAiSession>, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "사용자 홈 디렉터리를 찾을 수 없습니다.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || scan_roots(&home))
        .await
        .map_err(|error| format!("로컬 세션 스캔에 실패했습니다: {error}"))
}

fn scan_roots(home: &Path) -> Vec<LocalAiSession> {
    let mut candidates = Vec::new();
    let claude_home = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    collect_jsonl(&claude_home.join("projects"), "claude", &mut candidates);
    collect_jsonl(&codex_home.join("sessions"), "codex", &mut candidates);
    candidates.sort_by(|left, right| right.modified_at_ms.cmp(&left.modified_at_ms));

    let codex_titles = read_codex_titles(&codex_home.join("session_index.jsonl"));
    candidates
        .into_iter()
        .take(MAX_FILES)
        .filter_map(|candidate| {
            let mut session = match candidate.provider {
                "claude" => parse_claude(&candidate.path, candidate.modified_at_ms),
                "codex" => parse_codex(&candidate.path, candidate.modified_at_ms),
                _ => None,
            }?;
            if candidate.provider == "codex" {
                if let Some(title) = codex_titles.get(&session.session_id) {
                    if !is_internal_context(title) {
                        session.title = title.clone();
                    }
                }
            }
            Some(session)
        })
        .collect()
}

fn collect_jsonl(root: &Path, provider: &'static str, output: &mut Vec<Candidate>) {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => metadata,
        _ => return,
    };
    let _ = metadata;

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.file_type().is_symlink() => metadata,
            _ => continue,
        };
        if metadata.is_dir() {
            collect_jsonl(&path, provider, output);
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            let modified_at_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or_default();
            output.push(Candidate {
                provider,
                path,
                modified_at_ms,
            });
        }
    }
}

fn read_json_lines(path: &Path, mut consume: impl FnMut(Value) -> bool) -> Option<()> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    for _ in 0..MAX_LINES_PER_FILE {
        line.clear();
        let bytes = reader.read_line(&mut line).ok()?;
        if bytes == 0 {
            break;
        }
        if line.len() > 1_048_576 {
            continue;
        }
        if let Ok(record) = serde_json::from_str::<Value>(&line) {
            if !consume(record) {
                break;
            }
        }
    }
    Some(())
}

fn parse_claude(path: &Path, modified_at_ms: u64) -> Option<LocalAiSession> {
    let fallback_id = file_stem(path);
    let mut draft = SessionDraft {
        session_id: fallback_id,
        ..Default::default()
    };
    read_json_lines(path, |record| {
        update_timeline(&mut draft, record.get("timestamp").and_then(Value::as_str));
        set_string(&mut draft.session_id, record.get("sessionId"));
        set_option(&mut draft.cwd, record.get("cwd"));
        match record.get("type").and_then(Value::as_str) {
            Some("custom-title") | Some("ai-title") | Some("agent-name") => {
                if let Some(title) = record
                    .get("customTitle")
                    .or_else(|| record.get("title"))
                    .or_else(|| record.get("name"))
                    .and_then(text_value)
                {
                    draft.title = normalized_preview(&title);
                }
            }
            Some("user") if record.get("isMeta").and_then(Value::as_bool) != Some(true) => {
                let text = record
                    .get("message")
                    .and_then(|value| value.get("content"))
                    .and_then(text_value);
                add_user_prompt(&mut draft, text);
                draft.message_count += 1;
            }
            Some("assistant") => {
                if let Some(model) = record.get("message").and_then(|value| value.get("model")) {
                    set_option(&mut draft.model, Some(model));
                }
                draft.message_count += 1;
            }
            _ => {}
        }
        true
    })?;
    finalize("claude", draft, modified_at_ms)
}

fn parse_codex(path: &Path, modified_at_ms: u64) -> Option<LocalAiSession> {
    let fallback_id = file_stem(path);
    let mut draft = SessionDraft {
        session_id: fallback_id,
        ..Default::default()
    };
    read_json_lines(path, |record| {
        update_timeline(&mut draft, record.get("timestamp").and_then(Value::as_str));
        let record_type = record.get("type").and_then(Value::as_str);
        let payload = record.get("payload");
        match record_type {
            Some("session_meta") => {
                if let Some(payload) = payload {
                    let source = payload
                        .get("thread_source")
                        .or_else(|| payload.get("threadSource"))
                        .and_then(Value::as_str);
                    if source.is_some_and(|source| !source.eq_ignore_ascii_case("user"))
                        || payload
                            .get("source")
                            .and_then(|value| value.get("subagent"))
                            .is_some()
                    {
                        draft.rejected = true;
                        return false;
                    }
                    set_string(&mut draft.session_id, payload.get("id"));
                    set_option(&mut draft.cwd, payload.get("cwd"));
                    for key in ["title", "thread_name", "threadName"] {
                        if let Some(value) = payload
                            .get(key)
                            .and_then(text_value)
                            .and_then(|value| normalized_preview(&value))
                        {
                            draft.title = Some(value);
                            break;
                        }
                    }
                }
            }
            Some("turn_context") => {
                if let Some(payload) = payload {
                    set_option(&mut draft.cwd, payload.get("cwd"));
                    set_option(&mut draft.model, payload.get("model"));
                }
            }
            Some("response_item")
                if payload
                    .and_then(|value| value.get("type"))
                    .and_then(Value::as_str)
                    == Some("message") =>
            {
                if let Some(payload) = payload {
                    let role = payload.get("role").and_then(Value::as_str);
                    if role == Some("user") {
                        add_user_prompt(&mut draft, payload.get("content").and_then(text_value));
                    }
                    if matches!(role, Some("user") | Some("assistant")) {
                        draft.message_count += 1;
                    }
                }
            }
            Some("event_msg") => {
                if let Some(payload) = payload {
                    match payload.get("type").and_then(Value::as_str) {
                        Some("user_message") => {
                            add_user_prompt(
                                &mut draft,
                                payload.get("message").and_then(text_value),
                            );
                            draft.message_count += 1;
                        }
                        Some("agent_message") => draft.message_count += 1,
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        true
    })?;
    finalize("codex", draft, modified_at_ms)
}

fn read_codex_titles(path: &Path) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    let _ = read_json_lines(path, |record| {
        if let (Some(id), Some(title)) = (
            record.get("id").and_then(Value::as_str),
            record
                .get("thread_name")
                .and_then(Value::as_str)
                .and_then(normalized_preview),
        ) {
            if !is_internal_context(&title) {
                titles.insert(id.to_string(), title);
            }
        }
        true
    });
    titles
}

fn finalize(
    provider: &str,
    mut draft: SessionDraft,
    modified_at_ms: u64,
) -> Option<LocalAiSession> {
    if draft.rejected || draft.session_id.trim().is_empty() {
        return None;
    }
    let title = draft
        .title
        .take()
        .filter(|value| !is_internal_context(value))
        .or_else(|| draft.first_prompt.clone())
        .filter(|value| !is_internal_context(value))
        .or_else(|| draft.last_prompt.clone())
        .unwrap_or_else(|| "제목 없는 세션".into());
    Some(LocalAiSession {
        provider: provider.into(),
        session_id: draft.session_id,
        title,
        cwd: draft.cwd,
        model: draft.model,
        first_prompt: draft.first_prompt,
        last_prompt: draft.last_prompt,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
        modified_at_ms,
        message_count: draft.message_count,
    })
}

fn add_user_prompt(draft: &mut SessionDraft, value: Option<String>) {
    let Some(value) = value.and_then(|value| normalized_preview(&value)) else {
        return;
    };
    if is_internal_context(&value) {
        return;
    }
    if draft.first_prompt.is_none() {
        draft.first_prompt = Some(value.clone());
    }
    draft.last_prompt = Some(value);
}

fn is_internal_context(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    [
        "<environment_context>",
        "<permissions instructions>",
        "<collaboration_mode>",
        "<apps_instructions>",
        "<plugins_instructions>",
        "<skills_instructions>",
        "<multi_agent_mode>",
    ]
    .iter()
    .any(|prefix| normalized.starts_with(prefix))
}

fn update_timeline(draft: &mut SessionDraft, timestamp: Option<&str>) {
    let Some(timestamp) = timestamp else { return };
    if draft.created_at.is_none() {
        draft.created_at = Some(timestamp.into());
    }
    draft.updated_at = Some(timestamp.into());
}

fn text_value(value: &Value) -> Option<String> {
    if let Some(value) = value.as_str() {
        return Some(value.into());
    }
    let values = value.as_array()?;
    let text = values
        .iter()
        .filter_map(|item| {
            if item
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| matches!(kind, "text" | "input_text" | "output_text"))
            {
                item.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

fn normalized_preview(value: &str) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.chars().take(MAX_PREVIEW_CHARS).collect())
}

fn set_string(target: &mut String, value: Option<&Value>) {
    if let Some(value) = value.and_then(Value::as_str) {
        *target = value.into();
    }
}

fn set_option(target: &mut Option<String>, value: Option<&Value>) {
    if let Some(value) = value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        *target = Some(value.into());
    }
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(name: &str, content: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("orbit-{name}-{}.jsonl", std::process::id()));
        let mut file = File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn parses_codex_user_session() {
        let path = fixture("codex", concat!(
            "{\"timestamp\":\"2026-08-05T01:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-1\",\"cwd\":\"/work/orbit\",\"thread_source\":\"user\"}}\n",
            "{\"timestamp\":\"2026-08-05T01:01:00Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Workspace를 만들어줘\"}}\n",
            "{\"timestamp\":\"2026-08-05T01:02:00Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5\"}}\n"
        ));
        let session = parse_codex(&path, 10).unwrap();
        assert_eq!(session.session_id, "codex-1");
        assert_eq!(session.title, "Workspace를 만들어줘");
        assert_eq!(session.model.as_deref(), Some("gpt-5"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn parses_claude_session_and_ignores_meta_prompt() {
        let path = fixture("claude", concat!(
            "{\"sessionId\":\"claude-1\",\"timestamp\":\"2026-08-05T01:00:00Z\",\"cwd\":\"/work/orbit\",\"type\":\"user\",\"isMeta\":true,\"message\":{\"content\":\"hidden\"}}\n",
            "{\"sessionId\":\"claude-1\",\"timestamp\":\"2026-08-05T01:01:00Z\",\"type\":\"user\",\"message\":{\"content\":\"태스크를 정리해줘\"}}\n",
            "{\"sessionId\":\"claude-1\",\"timestamp\":\"2026-08-05T01:02:00Z\",\"type\":\"assistant\",\"message\":{\"model\":\"claude-sonnet\",\"content\":[]}}\n"
        ));
        let session = parse_claude(&path, 10).unwrap();
        assert_eq!(session.title, "태스크를 정리해줘");
        assert_eq!(session.first_prompt.as_deref(), Some("태스크를 정리해줘"));
        assert_eq!(session.model.as_deref(), Some("claude-sonnet"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn ignores_codex_environment_context_as_a_user_prompt() {
        let path = fixture(
            "codex-context",
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-2\",\"thread_source\":\"user\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"<environment_context><cwd>/work</cwd></environment_context>\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"실제 사용자 작업\"}}\n"
            ),
        );
        let session = parse_codex(&path, 10).unwrap();
        assert_eq!(session.title, "실제 사용자 작업");
        assert_eq!(session.first_prompt.as_deref(), Some("실제 사용자 작업"));
        let _ = fs::remove_file(path);
    }
}
