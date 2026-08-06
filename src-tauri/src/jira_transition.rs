use reqwest::{blocking::Client, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraStatusSnapshot {
    pub id: String,
    pub name: String,
    pub category_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransitionOption {
    pub id: String,
    pub name: String,
    pub target: JiraStatusSnapshot,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransitionPreview {
    pub issue_key: String,
    pub observed_status: JiraStatusSnapshot,
    pub transition: JiraTransitionOption,
    pub available_transitions_hash: String,
    pub preview_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedJiraTransition {
    pub preview: JiraTransitionPreview,
    pub approved_preview_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransitionExecution {
    pub issue_key: String,
    pub transition_id: String,
    pub target_status: JiraStatusSnapshot,
    pub outcome: JiraExecutionOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JiraExecutionOutcome {
    Succeeded,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransitionReconciliation {
    pub issue_key: String,
    pub current_status: JiraStatusSnapshot,
    pub outcome: JiraReconciliationOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JiraReconciliationOutcome {
    Succeeded,
    Retryable,
    NeedsUserReview,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JiraErrorCategory {
    Authentication,
    Authorization,
    NotFound,
    InvalidRequest,
    StaleApproval,
    RateLimited,
    Conflict,
    Unavailable,
    Network,
    InvalidResponse,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransitionError {
    pub category: JiraErrorCategory,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
}

impl JiraTransitionError {
    fn new(category: JiraErrorCategory, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            category,
            message: message.into(),
            retryable,
            retry_after_seconds: None,
        }
    }

    fn with_retry_after(mut self, retry_after_seconds: Option<u64>) -> Self {
        self.retry_after_seconds = retry_after_seconds;
        self
    }

    fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(JiraErrorCategory::InvalidRequest, message, false)
    }

    fn stale(message: impl Into<String>) -> Self {
        Self::new(JiraErrorCategory::StaleApproval, message, false)
    }

    fn network(message: impl Into<String>) -> Self {
        Self::new(JiraErrorCategory::Network, message, true)
    }

    fn invalid_response(message: impl Into<String>) -> Self {
        Self::new(JiraErrorCategory::InvalidResponse, message, true)
    }
}

#[derive(Deserialize)]
struct JiraIssueStatusResponse {
    fields: JiraIssueStatusFields,
}

#[derive(Deserialize)]
struct JiraIssueStatusFields {
    status: JiraStatusResponse,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraStatusResponse {
    id: String,
    name: String,
    status_category: JiraStatusCategoryResponse,
}

#[derive(Clone, Deserialize)]
struct JiraStatusCategoryResponse {
    key: String,
}

#[derive(Deserialize)]
struct JiraTransitionsResponse {
    #[serde(default)]
    transitions: Vec<JiraTransitionResponse>,
}

#[derive(Deserialize)]
struct JiraTransitionResponse {
    id: String,
    name: String,
    to: JiraStatusResponse,
}

#[derive(Serialize)]
struct JiraTransitionPostBody<'a> {
    transition: JiraTransitionPostId<'a>,
}

#[derive(Serialize)]
struct JiraTransitionPostId<'a> {
    id: &'a str,
}

trait JiraTransitionTransport {
    fn status(&mut self, issue_key: &str) -> Result<JiraStatusSnapshot, JiraTransitionError>;
    fn transitions(
        &mut self,
        issue_key: &str,
    ) -> Result<Vec<JiraTransitionOption>, JiraTransitionError>;
    fn post_transition(
        &mut self,
        issue_key: &str,
        transition_id: &str,
    ) -> Result<(), JiraTransitionError>;
}

struct ReqwestJiraTransitionTransport {
    client: Client,
    base_url: Url,
    email: String,
    token: String,
}

impl ReqwestJiraTransitionTransport {
    fn new(jira_url: &str, jira_email: &str) -> Result<Self, JiraTransitionError> {
        let base_url = super::jira_issue::validate_jira_cloud_url(jira_url)
            .map_err(JiraTransitionError::invalid_request)?;
        let email = jira_email.trim().to_string();
        if email.is_empty() {
            return Err(JiraTransitionError::invalid_request(
                "Settings에서 Jira 계정 이메일을 입력해주세요.",
            ));
        }
        let token = super::get_secret("jira_api_token").map_err(|message| {
            JiraTransitionError::new(JiraErrorCategory::Authentication, message, false)
        })?;
        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| JiraTransitionError::network(error.to_string()))?;
        Ok(Self {
            client,
            base_url,
            email,
            token,
        })
    }

    fn endpoint(&self, issue_key: &str, suffix: &str) -> Result<Url, JiraTransitionError> {
        self.base_url
            .join(&format!("rest/api/3/issue/{issue_key}{suffix}"))
            .map_err(|_| JiraTransitionError::invalid_request("Jira 요청 URL을 만들지 못했습니다."))
    }
}

impl JiraTransitionTransport for ReqwestJiraTransitionTransport {
    fn status(&mut self, issue_key: &str) -> Result<JiraStatusSnapshot, JiraTransitionError> {
        let response = self
            .client
            .get(self.endpoint(issue_key, "?fields=status")?)
            .basic_auth(&self.email, Some(&self.token))
            .header("Accept", "application/json")
            .send()
            .map_err(|error| {
                JiraTransitionError::network(format!("Jira 상태를 읽지 못했습니다. ({error})"))
            })?;
        let response = checked_response(response)?;
        let body = response
            .json::<JiraIssueStatusResponse>()
            .map_err(|error| {
                JiraTransitionError::invalid_response(format!(
                    "Jira 상태 응답을 읽지 못했습니다. ({error})"
                ))
            })?;
        Ok(status_snapshot(body.fields.status))
    }

    fn transitions(
        &mut self,
        issue_key: &str,
    ) -> Result<Vec<JiraTransitionOption>, JiraTransitionError> {
        let response = self
            .client
            .get(self.endpoint(issue_key, "/transitions")?)
            .basic_auth(&self.email, Some(&self.token))
            .header("Accept", "application/json")
            .send()
            .map_err(|error| {
                JiraTransitionError::network(format!("Jira 전이 목록을 읽지 못했습니다. ({error})"))
            })?;
        let response = checked_response(response)?;
        let body = response
            .json::<JiraTransitionsResponse>()
            .map_err(|error| {
                JiraTransitionError::invalid_response(format!(
                    "Jira 전이 응답을 읽지 못했습니다. ({error})"
                ))
            })?;
        Ok(body
            .transitions
            .into_iter()
            .map(|transition| JiraTransitionOption {
                id: transition.id,
                name: transition.name,
                target: status_snapshot(transition.to),
            })
            .collect())
    }

    fn post_transition(
        &mut self,
        issue_key: &str,
        transition_id: &str,
    ) -> Result<(), JiraTransitionError> {
        let response = self
            .client
            .post(self.endpoint(issue_key, "/transitions")?)
            .basic_auth(&self.email, Some(&self.token))
            .header("Accept", "application/json")
            .json(&JiraTransitionPostBody {
                transition: JiraTransitionPostId { id: transition_id },
            })
            .send()
            .map_err(|error| {
                JiraTransitionError::network(format!("Jira 상태를 변경하지 못했습니다. ({error})"))
            })?;
        checked_response(response).map(|_| ())
    }
}

fn checked_response(
    response: reqwest::blocking::Response,
) -> Result<reqwest::blocking::Response, JiraTransitionError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let retry_after_seconds = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    Err(classify_http_status(status.as_u16(), retry_after_seconds))
}

fn classify_http_status(status: u16, retry_after_seconds: Option<u64>) -> JiraTransitionError {
    match status {
        400 | 405 | 422 => JiraTransitionError::new(
            JiraErrorCategory::InvalidRequest,
            format!("Jira 요청이 거부되었습니다. ({status})"),
            false,
        ),
        401 => JiraTransitionError::new(
            JiraErrorCategory::Authentication,
            "Jira 인증 정보를 확인해주세요.",
            false,
        ),
        403 => JiraTransitionError::new(
            JiraErrorCategory::Authorization,
            "Jira 이슈 전이 권한을 확인해주세요.",
            false,
        ),
        404 => JiraTransitionError::new(
            JiraErrorCategory::NotFound,
            "Jira 이슈 또는 전이를 찾지 못했습니다.",
            false,
        ),
        409 => JiraTransitionError::new(
            JiraErrorCategory::Conflict,
            "Jira 상태가 동시에 변경되었습니다.",
            true,
        ),
        429 => JiraTransitionError::new(
            JiraErrorCategory::RateLimited,
            retry_after_seconds
                .map(|seconds| {
                    format!("Jira 호출 한도에 도달했습니다. {seconds}초 후 다시 시도해주세요.")
                })
                .unwrap_or_else(|| "Jira 호출 한도에 도달했습니다.".into()),
            true,
        )
        .with_retry_after(retry_after_seconds),
        500..=599 => JiraTransitionError::new(
            JiraErrorCategory::Unavailable,
            format!("Jira가 일시적으로 응답하지 않습니다. ({status})"),
            true,
        ),
        _ => JiraTransitionError::new(
            JiraErrorCategory::InvalidResponse,
            format!("Jira에서 예상하지 못한 응답을 받았습니다. ({status})"),
            true,
        ),
    }
}

fn status_snapshot(status: JiraStatusResponse) -> JiraStatusSnapshot {
    JiraStatusSnapshot {
        id: status.id,
        name: status.name,
        category_key: status.status_category.key,
    }
}

fn normalize_issue_key(value: &str) -> Result<String, JiraTransitionError> {
    let value = value.trim().to_ascii_uppercase();
    let Some((project, number)) = value.split_once('-') else {
        return Err(JiraTransitionError::invalid_request(
            "올바른 Jira 이슈 키를 입력해주세요.",
        ));
    };
    if project.len() < 2
        || !project
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        || number.is_empty()
        || !number.chars().all(|character| character.is_ascii_digit())
    {
        return Err(JiraTransitionError::invalid_request(
            "올바른 Jira 이슈 키를 입력해주세요.",
        ));
    }
    Ok(value)
}

fn normalized_transitions(mut transitions: Vec<JiraTransitionOption>) -> Vec<JiraTransitionOption> {
    transitions.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then(left.name.cmp(&right.name))
            .then(left.target.id.cmp(&right.target.id))
    });
    transitions
}

fn available_transitions_hash(transitions: &[JiraTransitionOption]) -> String {
    let canonical = normalized_transitions(transitions.to_vec())
        .into_iter()
        .map(|transition| {
            format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
                transition.id,
                transition.name,
                transition.target.id,
                transition.target.name,
                transition.target.category_key
            )
        })
        .collect::<Vec<_>>()
        .join("\u{1e}");
    stable_hash(canonical.as_bytes())
}

fn preview_hash(
    issue_key: &str,
    observed_status: &JiraStatusSnapshot,
    transition: &JiraTransitionOption,
    transitions_hash: &str,
) -> String {
    let canonical = [
        "jira-status-transition-v1",
        issue_key,
        &observed_status.id,
        &observed_status.name,
        &observed_status.category_key,
        &transition.id,
        &transition.name,
        &transition.target.id,
        &transition.target.name,
        &transition.target.category_key,
        transitions_hash,
    ]
    .join("\u{1f}");
    stable_hash(canonical.as_bytes())
}

// Stable, dependency-free FNV-1a 128. This is an integrity/correlation hash, not a secret MAC.
// Execution safety comes from re-reading Jira and comparing every bound field immediately before POST.
fn stable_hash(bytes: &[u8]) -> String {
    let mut value: u128 = 0x6c62272e07bb014262b821756295c58d;
    for byte in bytes {
        value ^= u128::from(*byte);
        value = value.wrapping_mul(0x0000000001000000000000000000013b);
    }
    format!("{value:032x}")
}

fn build_preview<T: JiraTransitionTransport>(
    transport: &mut T,
    issue_key: &str,
    target_category: &str,
    preferred_transition_id: Option<&str>,
) -> Result<JiraTransitionPreview, JiraTransitionError> {
    let issue_key = normalize_issue_key(issue_key)?;
    let target_category = target_category.trim().to_ascii_lowercase();
    if target_category != "done" {
        return Err(JiraTransitionError::invalid_request(
            "현재 Jira 쓰기는 Done 상태 전이만 지원합니다.",
        ));
    }
    let observed_status = transport.status(&issue_key)?;
    let transitions = normalized_transitions(transport.transitions(&issue_key)?);
    let transition = if observed_status.category_key == target_category {
        JiraTransitionOption {
            id: String::new(),
            name: "Already Done".into(),
            target: observed_status.clone(),
        }
    } else if let Some(preferred_id) = preferred_transition_id {
        transitions
            .iter()
            .find(|transition| {
                transition.id == preferred_id && transition.target.category_key == target_category
            })
            .cloned()
            .ok_or_else(|| {
                JiraTransitionError::invalid_request(
                    "현재 Jira 상태에서 선택한 Done 전이를 사용할 수 없습니다.",
                )
            })?
    } else {
        transitions
            .iter()
            .find(|transition| transition.target.category_key == target_category)
            .cloned()
            .ok_or_else(|| {
                JiraTransitionError::invalid_request(
                    "현재 Jira 상태에서 사용할 수 있는 Done 전이가 없습니다.",
                )
            })?
    };
    let available_transitions_hash = available_transitions_hash(&transitions);
    let preview_hash = preview_hash(
        &issue_key,
        &observed_status,
        &transition,
        &available_transitions_hash,
    );
    Ok(JiraTransitionPreview {
        issue_key,
        observed_status,
        transition,
        available_transitions_hash,
        preview_hash,
    })
}

fn execute_approved<T: JiraTransitionTransport>(
    transport: &mut T,
    approved: ApprovedJiraTransition,
) -> Result<JiraTransitionExecution, JiraTransitionError> {
    let preview = approved.preview;
    let issue_key = normalize_issue_key(&preview.issue_key)?;
    if preview.transition.target.category_key != "done" {
        return Err(JiraTransitionError::invalid_request(
            "현재 Jira 쓰기는 Done 상태 전이만 지원합니다.",
        ));
    }
    if preview.transition.id.is_empty() && preview.observed_status.category_key != "done" {
        return Err(JiraTransitionError::invalid_request(
            "Jira 전이 id가 없는 승인은 이미 Done인 이슈에만 사용할 수 있습니다.",
        ));
    }
    let recomputed_preview_hash = preview_hash(
        &issue_key,
        &preview.observed_status,
        &preview.transition,
        &preview.available_transitions_hash,
    );
    if approved.approved_preview_hash != preview.preview_hash
        || preview.preview_hash != recomputed_preview_hash
    {
        return Err(JiraTransitionError::stale(
            "승인한 Jira 미리보기 내용이 변경되었습니다. 다시 확인해주세요.",
        ));
    }

    let current_status = transport.status(&issue_key)?;
    if current_status.id == preview.transition.target.id
        || (current_status.name == preview.transition.target.name
            && current_status.category_key == preview.transition.target.category_key)
    {
        return Ok(JiraTransitionExecution {
            issue_key,
            transition_id: preview.transition.id,
            target_status: preview.transition.target,
            outcome: JiraExecutionOutcome::Succeeded,
        });
    }
    if current_status != preview.observed_status {
        return Err(JiraTransitionError::stale(
            "Jira 상태가 미리보기 이후 변경되었습니다. 새 미리보기가 필요합니다.",
        ));
    }
    let transitions = normalized_transitions(transport.transitions(&issue_key)?);
    if available_transitions_hash(&transitions) != preview.available_transitions_hash {
        return Err(JiraTransitionError::stale(
            "사용 가능한 Jira 전이가 미리보기 이후 변경되었습니다. 새 미리보기가 필요합니다.",
        ));
    }
    let exact_transition_is_available = transitions.iter().any(|transition| {
        transition.id == preview.transition.id
            && transition.name == preview.transition.name
            && transition.target == preview.transition.target
    });
    if !exact_transition_is_available {
        return Err(JiraTransitionError::stale(
            "승인한 Jira 전이를 더 이상 사용할 수 없습니다.",
        ));
    }

    transport.post_transition(&issue_key, &preview.transition.id)?;
    Ok(JiraTransitionExecution {
        issue_key,
        transition_id: preview.transition.id,
        target_status: preview.transition.target,
        outcome: JiraExecutionOutcome::Succeeded,
    })
}

fn reconcile<T: JiraTransitionTransport>(
    transport: &mut T,
    preview: JiraTransitionPreview,
) -> Result<JiraTransitionReconciliation, JiraTransitionError> {
    let issue_key = normalize_issue_key(&preview.issue_key)?;
    let current_status = transport.status(&issue_key)?;
    let outcome = if current_status.id == preview.transition.target.id
        || (current_status.name == preview.transition.target.name
            && current_status.category_key == preview.transition.target.category_key)
    {
        JiraReconciliationOutcome::Succeeded
    } else if current_status == preview.observed_status {
        let transitions = transport.transitions(&issue_key)?;
        if transitions.iter().any(|transition| {
            transition.id == preview.transition.id && transition.target == preview.transition.target
        }) {
            JiraReconciliationOutcome::Retryable
        } else {
            JiraReconciliationOutcome::NeedsUserReview
        }
    } else {
        JiraReconciliationOutcome::NeedsUserReview
    };
    Ok(JiraTransitionReconciliation {
        issue_key,
        current_status,
        outcome,
    })
}

#[tauri::command]
pub async fn preview_jira_status_transition(
    jira_url: String,
    jira_email: String,
    issue_key: String,
    target_category: String,
    preferred_transition_id: Option<String>,
) -> Result<JiraTransitionPreview, JiraTransitionError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut transport = ReqwestJiraTransitionTransport::new(&jira_url, &jira_email)?;
        build_preview(
            &mut transport,
            &issue_key,
            &target_category,
            preferred_transition_id.as_deref(),
        )
    })
    .await
    .map_err(|_| JiraTransitionError::network("Jira 전이 미리보기 작업이 중단되었습니다."))?
}

#[tauri::command]
pub async fn execute_approved_jira_status_transition(
    jira_url: String,
    jira_email: String,
    approved: ApprovedJiraTransition,
) -> Result<JiraTransitionExecution, JiraTransitionError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut transport = ReqwestJiraTransitionTransport::new(&jira_url, &jira_email)?;
        execute_approved(&mut transport, approved)
    })
    .await
    .map_err(|_| JiraTransitionError::network("Jira 전이 실행 작업이 중단되었습니다."))?
}

#[tauri::command]
pub async fn reconcile_jira_status_transition(
    jira_url: String,
    jira_email: String,
    preview: JiraTransitionPreview,
) -> Result<JiraTransitionReconciliation, JiraTransitionError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut transport = ReqwestJiraTransitionTransport::new(&jira_url, &jira_email)?;
        reconcile(&mut transport, preview)
    })
    .await
    .map_err(|_| JiraTransitionError::network("Jira 전이 복구 확인 작업이 중단되었습니다."))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(id: &str, name: &str, category_key: &str) -> JiraStatusSnapshot {
        JiraStatusSnapshot {
            id: id.into(),
            name: name.into(),
            category_key: category_key.into(),
        }
    }

    fn transition(id: &str, name: &str, target: JiraStatusSnapshot) -> JiraTransitionOption {
        JiraTransitionOption {
            id: id.into(),
            name: name.into(),
            target,
        }
    }

    struct FakeTransport {
        current: JiraStatusSnapshot,
        available: Vec<JiraTransitionOption>,
        posted: Vec<(String, String)>,
    }

    impl JiraTransitionTransport for FakeTransport {
        fn status(&mut self, _issue_key: &str) -> Result<JiraStatusSnapshot, JiraTransitionError> {
            Ok(self.current.clone())
        }

        fn transitions(
            &mut self,
            _issue_key: &str,
        ) -> Result<Vec<JiraTransitionOption>, JiraTransitionError> {
            Ok(self.available.clone())
        }

        fn post_transition(
            &mut self,
            issue_key: &str,
            transition_id: &str,
        ) -> Result<(), JiraTransitionError> {
            self.posted
                .push((issue_key.to_string(), transition_id.to_string()));
            Ok(())
        }
    }

    fn fake() -> FakeTransport {
        FakeTransport {
            current: status("1", "In Progress", "indeterminate"),
            available: vec![
                transition("31", "Backlog", status("10", "To Do", "new")),
                transition("41", "Complete", status("20", "Done", "done")),
            ],
            posted: Vec::new(),
        }
    }

    #[test]
    fn selects_and_binds_exact_done_transition() {
        let mut transport = fake();
        let preview = build_preview(&mut transport, " cgkr-2492 ", "done", None).unwrap();
        assert_eq!(preview.issue_key, "CGKR-2492");
        assert_eq!(preview.transition.id, "41");
        assert_eq!(preview.transition.target.category_key, "done");
        assert_eq!(preview.preview_hash.len(), 32);
        assert_eq!(preview.available_transitions_hash.len(), 32);
    }

    #[test]
    fn transition_hash_is_order_independent() {
        let transport = fake();
        let mut reversed = transport.available.clone();
        reversed.reverse();
        assert_eq!(
            available_transitions_hash(&transport.available),
            available_transitions_hash(&reversed)
        );
    }

    #[test]
    fn rejects_tampered_approval_before_post() {
        let mut transport = fake();
        let mut preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        let approved_hash = preview.preview_hash.clone();
        preview.transition.name = "Injected".into();
        let error = execute_approved(
            &mut transport,
            ApprovedJiraTransition {
                preview,
                approved_preview_hash: approved_hash,
            },
        )
        .unwrap_err();
        assert_eq!(error.category, JiraErrorCategory::StaleApproval);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn rejects_forged_non_done_transition_even_with_matching_hash() {
        let mut transport = fake();
        let mut preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        preview.transition = transition("31", "Backlog", status("10", "To Do", "new"));
        preview.preview_hash = preview_hash(
            &preview.issue_key,
            &preview.observed_status,
            &preview.transition,
            &preview.available_transitions_hash,
        );
        let approved_hash = preview.preview_hash.clone();
        let error = execute_approved(
            &mut transport,
            ApprovedJiraTransition {
                preview,
                approved_preview_hash: approved_hash,
            },
        )
        .unwrap_err();
        assert_eq!(error.category, JiraErrorCategory::InvalidRequest);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn changed_external_status_invalidates_approval() {
        let mut transport = fake();
        let preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        transport.current = status("10", "To Do", "new");
        let approved_hash = preview.preview_hash.clone();
        let error = execute_approved(
            &mut transport,
            ApprovedJiraTransition {
                preview,
                approved_preview_hash: approved_hash,
            },
        )
        .unwrap_err();
        assert_eq!(error.category, JiraErrorCategory::StaleApproval);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn available_transition_change_invalidates_same_status_approval() {
        let mut transport = fake();
        let preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        transport.available.push(transition(
            "51",
            "Cancel",
            status("30", "Cancelled", "done"),
        ));
        let approved_hash = preview.preview_hash.clone();
        let error = execute_approved(
            &mut transport,
            ApprovedJiraTransition {
                preview,
                approved_preview_hash: approved_hash,
            },
        )
        .unwrap_err();
        assert_eq!(error.category, JiraErrorCategory::StaleApproval);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn posts_only_the_approved_exact_transition() {
        let mut transport = fake();
        let preview = build_preview(&mut transport, "CGKR-2492", "done", Some("41")).unwrap();
        let approved_hash = preview.preview_hash.clone();
        let result = execute_approved(
            &mut transport,
            ApprovedJiraTransition {
                preview,
                approved_preview_hash: approved_hash,
            },
        )
        .unwrap();
        assert_eq!(result.outcome, JiraExecutionOutcome::Succeeded);
        assert_eq!(transport.posted, vec![("CGKR-2492".into(), "41".into())]);
    }

    #[test]
    fn already_target_execution_succeeds_without_post() {
        let mut transport = fake();
        transport.current = status("20", "Done", "done");
        transport.available.clear();
        let preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        assert!(preview.transition.id.is_empty());
        let approved_hash = preview.preview_hash.clone();
        let result = execute_approved(
            &mut transport,
            ApprovedJiraTransition {
                preview,
                approved_preview_hash: approved_hash,
            },
        )
        .unwrap();
        assert_eq!(result.outcome, JiraExecutionOutcome::Succeeded);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn reconciliation_never_posts_and_detects_remote_success() {
        let mut transport = fake();
        let preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        transport.current = status("20", "Done", "done");
        let result = reconcile(&mut transport, preview).unwrap();
        assert_eq!(result.outcome, JiraReconciliationOutcome::Succeeded);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn reconciliation_marks_unchanged_available_transition_retryable() {
        let mut transport = fake();
        let preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        let result = reconcile(&mut transport, preview).unwrap();
        assert_eq!(result.outcome, JiraReconciliationOutcome::Retryable);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn reconciliation_requires_review_when_state_diverged() {
        let mut transport = fake();
        let preview = build_preview(&mut transport, "CGKR-2492", "done", None).unwrap();
        transport.current = status("30", "QA", "indeterminate");
        let result = reconcile(&mut transport, preview).unwrap();
        assert_eq!(result.outcome, JiraReconciliationOutcome::NeedsUserReview);
        assert!(transport.posted.is_empty());
    }

    #[test]
    fn classifies_retryable_and_terminal_http_failures() {
        assert_eq!(
            classify_http_status(401, None).category,
            JiraErrorCategory::Authentication
        );
        assert!(!classify_http_status(401, None).retryable);
        assert_eq!(
            classify_http_status(429, Some(12)).category,
            JiraErrorCategory::RateLimited
        );
        assert!(classify_http_status(429, Some(12)).retryable);
        assert_eq!(
            classify_http_status(429, Some(12)).retry_after_seconds,
            Some(12)
        );
        assert_eq!(
            classify_http_status(503, None).category,
            JiraErrorCategory::Unavailable
        );
        assert!(classify_http_status(503, None).retryable);
    }
}
