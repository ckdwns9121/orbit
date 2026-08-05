use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCandidateInput {
    id: String,
    source: String,
    title: String,
    detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RankedContextCandidate {
    id: String,
    score: u8,
    reason: String,
}

#[derive(Debug, Deserialize)]
struct ContextRanking {
    matches: Vec<RankedContextCandidate>,
}

#[tauri::command]
pub async fn rank_task_context(
    task_title: String,
    model: String,
    candidates: Vec<ContextCandidateInput>,
) -> Result<Vec<RankedContextCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || rank(task_title, model, candidates))
        .await
        .map_err(|_| "AI 컨텍스트 분석이 중단되었습니다.".to_string())?
}

fn rank(
    task_title: String,
    model: String,
    candidates: Vec<ContextCandidateInput>,
) -> Result<Vec<RankedContextCandidate>, String> {
    let task_title = task_title.trim();
    if task_title.is_empty() {
        return Err("Task 제목이 비어 있습니다.".into());
    }
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let api_key = super::get_secret("openai_api_key")?;
    let model = if model.trim().is_empty() {
        "gpt-5.6-luna"
    } else {
        model.trim()
    };
    let candidates: Vec<_> = candidates
        .into_iter()
        .take(60)
        .map(|candidate| {
            json!({
                "id": candidate.id,
                "source": candidate.source,
                "title": truncate(&candidate.title, 240),
                "detail": truncate(&candidate.detail, 700),
            })
        })
        .collect();
    let valid_ids: HashSet<String> = candidates
        .iter()
        .filter_map(|candidate| candidate.get("id")?.as_str().map(str::to_string))
        .collect();

    let response = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "OpenAI HTTP 클라이언트를 만들지 못했습니다.".to_string())?
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "store": false,
            "reasoning": { "effort": "low" },
            "input": [
                {
                    "role": "system",
                    "content": [{
                        "type": "input_text",
                        "text": "You rank candidate work context for a personal task manager. Compare the Task title with each candidate. Return only genuinely related candidates. Score 0-100. Give one short Korean reason grounded in matching terms, issue keys, project, or intent. Never invent facts."
                    }]
                },
                {
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": format!("Task title:\n{}\n\nCandidates:\n{}", task_title, serde_json::to_string(&candidates).unwrap_or_default())
                    }]
                }
            ],
            "text": {
                "verbosity": "low",
                "format": {
                    "type": "json_schema",
                    "name": "task_context_ranking",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "matches": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": { "type": "string" },
                                        "score": { "type": "integer", "minimum": 0, "maximum": 100 },
                                        "reason": { "type": "string" }
                                    },
                                    "required": ["id", "score", "reason"],
                                    "additionalProperties": false
                                }
                            }
                        },
                        "required": ["matches"],
                        "additionalProperties": false
                    }
                }
            },
            "max_output_tokens": 2000
        }))
        .send()
        .map_err(|_| "OpenAI에 연결하지 못했습니다.".to_string())?;

    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "OpenAI API Key를 확인해주세요.".into(),
            429 => "OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.".into(),
            status => format!("OpenAI 컨텍스트 분석에 실패했습니다. ({status})"),
        });
    }

    let body: Value = response
        .json()
        .map_err(|_| "OpenAI 응답을 읽지 못했습니다.".to_string())?;
    let output = extract_output_text(&body)
        .ok_or_else(|| "OpenAI가 컨텍스트 분석 결과를 반환하지 않았습니다.".to_string())?;
    let ranking: ContextRanking = serde_json::from_str(output)
        .map_err(|_| "OpenAI 컨텍스트 분석 결과 형식이 올바르지 않습니다.".to_string())?;

    Ok(ranking
        .matches
        .into_iter()
        .filter(|candidate| valid_ids.contains(&candidate.id))
        .collect())
}

fn extract_output_text(body: &Value) -> Option<&str> {
    body.get("output")?
        .as_array()?
        .iter()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find_map(|content| {
            if content.get("type").and_then(Value::as_str) == Some("output_text") {
                content.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::extract_output_text;
    use serde_json::json;

    #[test]
    fn extracts_structured_output_text() {
        let body = json!({
            "output": [{
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": "{\"matches\":[]}"
                }]
            }]
        });
        assert_eq!(extract_output_text(&body), Some("{\"matches\":[]}"));
    }
}
