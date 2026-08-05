use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackConnection {
    workspace_name: String,
    workspace_id: String,
    user_name: String,
    user_id: String,
}

#[derive(Deserialize)]
struct SlackAuthResponse {
    ok: bool,
    error: Option<String>,
    team: Option<String>,
    team_id: Option<String>,
    user: Option<String>,
    user_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackSearchResult {
    query: String,
    messages: Vec<SlackSearchMessage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackSearchMessage {
    id: String,
    channel_id: String,
    channel_name: String,
    user_name: String,
    text: String,
    permalink: String,
    message_ts: String,
}

#[derive(Deserialize)]
struct SlackSearchResponse {
    ok: bool,
    error: Option<String>,
    messages: Option<SlackSearchMatches>,
}

#[derive(Deserialize)]
struct SlackSearchMatches {
    #[serde(default)]
    matches: Vec<SlackSearchMatch>,
}

#[derive(Deserialize)]
struct SlackSearchMatch {
    #[serde(default)]
    channel_id: String,
    #[serde(default)]
    channel_name: String,
    #[serde(default, alias = "user_name")]
    username: String,
    #[serde(default)]
    ts: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    permalink: String,
}

#[tauri::command]
pub async fn verify_slack_connection() -> Result<SlackConnection, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let token = super::get_secret("slack_oauth_token")?;
        let response = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|error| error.to_string())?
            .post("https://slack.com/api/auth.test")
            .bearer_auth(token)
            .send()
            .map_err(|error| format!("Slack에 연결하지 못했습니다. ({error})"))?
            .error_for_status()
            .map_err(|error| format!("Slack 연결을 확인하지 못했습니다. ({error})"))?
            .json::<SlackAuthResponse>()
            .map_err(|error| format!("Slack 응답을 읽지 못했습니다. ({error})"))?;
        if !response.ok {
            return Err(format!(
                "Slack 토큰이 유효하지 않습니다. ({})",
                response.error.unwrap_or_else(|| "unknown_error".into())
            ));
        }
        Ok(SlackConnection {
            workspace_name: response.team.unwrap_or_else(|| "Slack workspace".into()),
            workspace_id: response.team_id.unwrap_or_default(),
            user_name: response.user.unwrap_or_else(|| "Slack user".into()),
            user_id: response.user_id.unwrap_or_default(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn search_slack_messages(query: String) -> Result<SlackSearchResult, String> {
    let query = query.trim().chars().take(200).collect::<String>();
    if query.is_empty() {
        return Err("Slack에서 검색할 핵심 단어를 찾지 못했습니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let token = super::get_secret("slack_oauth_token")?;
        let response = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| error.to_string())?
            .get("https://slack.com/api/search.messages")
            .bearer_auth(token)
            .query(&[
                ("query", query.as_str()),
                ("count", "40"),
                ("sort", "timestamp"),
                ("sort_dir", "desc"),
                ("highlight", "false"),
            ])
            .send()
            .map_err(|error| format!("Slack 메시지를 검색하지 못했습니다. ({error})"))?;

        if response.status().as_u16() == 429 {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("잠시");
            return Err(format!(
                "Slack 검색 호출 한도에 도달했습니다. {retry_after}초 후 다시 시도해주세요."
            ));
        }
        let status = response.status();
        if !status.is_success() {
            return Err(format!("Slack 메시지 검색에 실패했습니다. ({status})"));
        }
        let response = response
            .json::<SlackSearchResponse>()
            .map_err(|error| format!("Slack 검색 응답을 읽지 못했습니다. ({error})"))?;
        if !response.ok {
            let error = response.error.unwrap_or_else(|| "unknown_error".into());
            let help = match error.as_str() {
                "missing_scope" => {
                    " Slack 앱의 User Token Scopes에 search:read를 추가하고 다시 설치해주세요."
                }
                "not_allowed_token_type" => {
                    " Bot Token이 아닌 xoxp- User OAuth Token을 저장해주세요."
                }
                _ => "",
            };
            return Err(format!(
                "Slack 메시지 검색이 거부되었습니다. ({error}){help}"
            ));
        }
        let messages = response
            .messages
            .map(|items| items.matches)
            .unwrap_or_default()
            .into_iter()
            .filter(|message| !message.text.trim().is_empty())
            .map(|message| {
                let id = format!("{}:{}", message.channel_id, message.ts);
                SlackSearchMessage {
                    id,
                    channel_id: message.channel_id,
                    channel_name: message.channel_name,
                    user_name: message.username,
                    text: message.text.chars().take(8_000).collect(),
                    permalink: message.permalink,
                    message_ts: message.ts,
                }
            })
            .collect();
        Ok(SlackSearchResult { query, messages })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::SlackSearchResponse;

    #[test]
    fn parses_message_search_matches() {
        let response: SlackSearchResponse = serde_json::from_str(
            r#"{"ok":true,"messages":{"matches":[{"channel_id":"C123","channel_name":"cgkr","username":"tester","ts":"123.456","text":"피킹 슬립 오류","permalink":"https://example.slack.com/archives/C123/p123456"}]}}"#,
        )
        .expect("valid Slack search response");
        let message = &response.messages.expect("messages").matches[0];
        assert_eq!(message.channel_name, "cgkr");
        assert_eq!(message.text, "피킹 슬립 오류");
    }
}
