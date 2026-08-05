use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

const MAX_SESSION_DIRECTORIES: usize = 40;
const MAX_REPOSITORIES: usize = 12;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueDevelopment {
    issue: JiraIssue,
    branches: Vec<LinkedBranch>,
    pull_requests: Vec<LinkedPullRequest>,
    commits: Vec<LinkedCommit>,
    builds: Vec<LinkedBuild>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignedJiraIssuesResult {
    issues: Vec<AssignedJiraIssue>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignedJiraIssue {
    key: String,
    summary: String,
    status: String,
    status_category: String,
    priority: Option<String>,
    project_key: String,
    project_name: String,
    due_date: Option<String>,
    updated_at: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JiraIssue {
    key: String,
    summary: String,
    status: String,
    assignee: Option<String>,
    updated_at: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedPullRequest {
    repository: String,
    number: u64,
    title: String,
    url: String,
    status: String,
    head_ref_name: String,
    author_login: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedBranch {
    repository: String,
    name: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedCommit {
    repository: String,
    sha: String,
    message: String,
    url: String,
    author_name: Option<String>,
    authored_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedBuild {
    repository: String,
    id: u64,
    name: String,
    url: String,
    status: String,
    conclusion: Option<String>,
    branch: String,
    created_at: String,
}

struct GithubClient {
    token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraIssueResponse {
    key: String,
    fields: JiraIssueFields,
}

#[derive(Debug, Deserialize)]
struct JiraIssueFields {
    summary: String,
    status: JiraStatus,
    assignee: Option<JiraAssignee>,
    updated: String,
    #[serde(default)]
    priority: Option<JiraNamedValue>,
    #[serde(default)]
    project: Option<JiraProject>,
    #[serde(default, rename = "duedate")]
    due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraNamedValue {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraStatus {
    name: String,
    status_category: JiraStatusCategory,
}

#[derive(Debug, Deserialize)]
struct JiraStatusCategory {
    key: String,
}

#[derive(Debug, Deserialize)]
struct JiraProject {
    key: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraAssignee {
    display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequest {
    number: u64,
    title: String,
    url: String,
    state: String,
    head_ref_name: String,
    author: Option<GhLogin>,
}

#[derive(Debug, Deserialize)]
struct GhLogin {
    login: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhCommitSearchResult {
    sha: String,
    url: String,
    commit: GhCommitData,
}

#[derive(Debug, Deserialize)]
struct GhPullCommitResult {
    sha: String,
    html_url: String,
    commit: GhCommitData,
}

#[derive(Debug, Deserialize)]
struct GhCommitData {
    message: String,
    author: Option<GhCommitAuthor>,
}

#[derive(Debug, Deserialize)]
struct GhCommitAuthor {
    name: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhRepositorySearchItem {
    repository: GhSearchRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhSearchRepository {
    name_with_owner: String,
}

#[derive(Debug, Deserialize)]
struct GhAuthStatus {
    hosts: HashMap<String, Vec<GhAuthAccount>>,
}

#[derive(Debug, Deserialize)]
struct GhAuthAccount {
    login: String,
    state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhWorkflowRun {
    database_id: u64,
    workflow_name: String,
    display_title: String,
    url: String,
    status: String,
    conclusion: Option<String>,
    head_branch: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JiraSearchRequest<'a> {
    jql: &'a str,
    fields: Vec<&'a str>,
    max_results: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_page_token: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraSearchResponse {
    #[serde(default)]
    issues: Vec<JiraIssueResponse>,
    next_page_token: Option<String>,
}

#[tauri::command]
pub async fn fetch_jira_issue_development(
    jira_url: String,
    jira_email: String,
    issue_key: String,
    cwds: Vec<String>,
) -> Result<JiraIssueDevelopment, String> {
    tauri::async_runtime::spawn_blocking(move || fetch(jira_url, jira_email, issue_key, cwds))
        .await
        .map_err(|_| "Jira 개발 정보 조회가 중단되었습니다.".to_string())?
}

#[tauri::command]
pub async fn fetch_assigned_jira_issues(
    jira_url: String,
    jira_email: String,
) -> Result<AssignedJiraIssuesResult, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_assigned(jira_url, jira_email))
        .await
        .map_err(|_| "담당 Jira 티켓 조회가 중단되었습니다.".to_string())?
}

fn fetch_assigned(
    jira_url: String,
    jira_email: String,
) -> Result<AssignedJiraIssuesResult, String> {
    let base_url = validate_jira_cloud_url(&jira_url)?;
    if jira_email.trim().is_empty() {
        return Err("Settings에서 Jira 계정 이메일을 입력해주세요.".into());
    }
    let token = super::get_secret("jira_api_token")?;
    let search_url = base_url
        .join("rest/api/3/search/jql")
        .map_err(|_| "Jira 검색 URL을 만들지 못했습니다.".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Jira HTTP 클라이언트를 만들지 못했습니다.".to_string())?;
    let mut issues = Vec::new();
    let mut next_page_token: Option<String> = None;
    let mut truncated = false;

    loop {
        let body = JiraSearchRequest {
            jql: "assignee = currentUser() ORDER BY updated DESC",
            fields: vec![
                "summary", "status", "priority", "project", "duedate", "updated",
            ],
            max_results: 100,
            next_page_token: next_page_token.as_deref(),
        };
        let response = client
            .post(search_url.clone())
            .basic_auth(jira_email.trim(), Some(&token))
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .map_err(|_| "Jira에 연결하지 못했습니다.".to_string())?;
        if !response.status().is_success() {
            return Err(jira_status_error(response.status().as_u16()));
        }
        let page: JiraSearchResponse = response
            .json()
            .map_err(|_| "Jira 검색 응답을 읽지 못했습니다.".to_string())?;
        for response in page.issues {
            let Some(project) = response.fields.project else {
                continue;
            };
            let url = base_url
                .join(&format!("browse/{}", response.key))
                .map_err(|_| "Jira 티켓 URL을 만들지 못했습니다.".to_string())?
                .to_string();
            issues.push(AssignedJiraIssue {
                key: response.key,
                summary: response.fields.summary,
                status: response.fields.status.name,
                status_category: response.fields.status.status_category.key,
                priority: response.fields.priority.map(|value| value.name),
                project_key: project.key,
                project_name: project.name,
                due_date: response.fields.due_date,
                updated_at: response.fields.updated,
                url,
            });
        }
        next_page_token = page.next_page_token;
        if next_page_token.is_none() {
            break;
        }
        if issues.len() >= 500 {
            issues.truncate(500);
            truncated = true;
            break;
        }
    }

    Ok(AssignedJiraIssuesResult { issues, truncated })
}

fn fetch(
    jira_url: String,
    jira_email: String,
    issue_key: String,
    cwds: Vec<String>,
) -> Result<JiraIssueDevelopment, String> {
    let issue_key = normalize_issue_key(&issue_key)?;
    let base_url = validate_jira_cloud_url(&jira_url)?;
    if jira_email.trim().is_empty() {
        return Err("Settings에서 Jira 계정 이메일을 입력해주세요.".into());
    }
    let token = super::get_secret("jira_api_token")?;
    let issue_url = base_url
        .join(&format!(
            "rest/api/3/issue/{issue_key}?fields=summary,status,assignee,updated"
        ))
        .map_err(|_| "Jira 이슈 URL을 만들지 못했습니다.".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Jira HTTP 클라이언트를 만들지 못했습니다.".to_string())?;
    let response = client
        .get(issue_url)
        .basic_auth(jira_email.trim(), Some(token))
        .header("Accept", "application/json")
        .send()
        .map_err(|_| "Jira에 연결하지 못했습니다.".to_string())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Jira 인증 또는 이슈 조회 권한을 확인해주세요.".into(),
            404 => format!("Jira 이슈 {issue_key}를 찾지 못했습니다."),
            _ => format!("Jira 이슈 조회에 실패했습니다. ({})", response.status()),
        });
    }
    let response: JiraIssueResponse = response
        .json()
        .map_err(|_| "Jira 응답을 읽지 못했습니다.".to_string())?;
    let browse_url = base_url
        .join(&format!("browse/{}", response.key))
        .map_err(|_| "Jira 이슈 URL을 만들지 못했습니다.".to_string())?
        .to_string();

    let repositories = discover_repositories(cwds)?;
    let Some(gh) = find_executable("gh", &["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]) else {
        return Ok(JiraIssueDevelopment {
            issue: jira_issue(response, browse_url),
            branches: Vec::new(),
            pull_requests: Vec::new(),
            commits: Vec::new(),
            builds: Vec::new(),
            warnings: vec!["GitHub CLI(gh)를 찾지 못해 PR과 커밋을 조회하지 못했습니다.".into()],
        });
    };

    let clients = github_clients(&gh);
    let mut warnings = Vec::new();
    let mut repository_names: HashSet<String> = repositories.into_iter().collect();
    for client in &clients {
        match discover_issue_repositories(&gh, client, &issue_key) {
            Ok(items) => repository_names.extend(items),
            Err(message) => warnings_push_unique(&mut warnings, message),
        }
    }

    let mut pull_requests = Vec::new();
    let mut commits = Vec::new();
    for repository in repository_names {
        let mut repository_succeeded = false;
        for client in &clients {
            if let Ok(items) = github_pull_requests(&gh, client, &repository, &issue_key) {
                repository_succeeded = true;
                pull_requests.extend(items);
            }
            if let Ok(items) = github_commits(&gh, client, &repository, &issue_key) {
                repository_succeeded = true;
                commits.extend(items);
            }
        }
        if !repository_succeeded {
            warnings_push_unique(
                &mut warnings,
                format!("{repository}: 연결된 GitHub 계정으로 개발 정보를 조회하지 못했습니다."),
            );
        }
    }
    deduplicate_pull_requests(&mut pull_requests);
    for pull_request in &pull_requests {
        for client in &clients {
            if let Ok(items) = github_pull_request_commits(
                &gh,
                client,
                &pull_request.repository,
                pull_request.number,
            ) {
                commits.extend(items);
            }
        }
    }
    deduplicate_commits(&mut commits);
    pull_requests.sort_by(|left, right| {
        left.repository
            .cmp(&right.repository)
            .then(right.number.cmp(&left.number))
    });
    commits.sort_by(|left, right| right.authored_at.cmp(&left.authored_at));

    let mut branches: Vec<LinkedBranch> = pull_requests
        .iter()
        .map(|pull_request| LinkedBranch {
            repository: pull_request.repository.clone(),
            name: pull_request.head_ref_name.clone(),
            url: format!(
                "https://github.com/{}/tree/{}",
                pull_request.repository, pull_request.head_ref_name
            ),
        })
        .collect();
    branches.sort_by(|left, right| {
        left.repository
            .cmp(&right.repository)
            .then(left.name.cmp(&right.name))
    });
    branches.dedup_by(|left, right| left.repository == right.repository && left.name == right.name);

    let mut builds = Vec::new();
    for branch in &branches {
        for client in &clients {
            if let Ok(items) = github_builds(&gh, client, &branch.repository, &branch.name) {
                builds.extend(items);
            }
        }
    }
    builds.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    builds.dedup_by(|left, right| left.repository == right.repository && left.id == right.id);

    if branches.is_empty() && commits.is_empty() && pull_requests.is_empty() {
        warnings_push_unique(
            &mut warnings,
            format!("GitHub에서 {issue_key}가 포함된 브랜치·커밋·PR을 찾지 못했습니다."),
        );
    }

    Ok(JiraIssueDevelopment {
        issue: jira_issue(response, browse_url),
        branches,
        pull_requests,
        commits,
        builds,
        warnings,
    })
}

fn jira_issue(response: JiraIssueResponse, url: String) -> JiraIssue {
    JiraIssue {
        key: response.key,
        summary: response.fields.summary,
        status: response.fields.status.name,
        assignee: response.fields.assignee.map(|value| value.display_name),
        updated_at: response.fields.updated,
        url,
    }
}

fn jira_status_error(status: u16) -> String {
    match status {
        401 | 403 => "Jira 인증 또는 티켓 조회 권한을 확인해주세요.".into(),
        404 => "Jira 검색 API를 찾지 못했습니다.".into(),
        _ => format!("Jira 티켓 조회에 실패했습니다. ({status})"),
    }
}

fn github_pull_requests(
    gh: &Path,
    client: &GithubClient,
    repository: &str,
    issue_key: &str,
) -> Result<Vec<LinkedPullRequest>, String> {
    let output = github_output(
        gh,
        client,
        &[
            "pr",
            "list",
            "--repo",
            repository,
            "--state",
            "all",
            "--limit",
            "100",
            "--search",
            issue_key,
            "--json",
            "number,title,url,state,headRefName,author",
        ],
    )?;
    if !output.status.success() {
        return Err("PR을 조회하지 못했습니다.".into());
    }
    let items: Vec<GhPullRequest> = serde_json::from_slice(&output.stdout)
        .map_err(|_| "PR 응답을 읽지 못했습니다.".to_string())?;
    let needle = issue_key.to_ascii_uppercase();
    Ok(items
        .into_iter()
        .filter(|item| {
            item.title.to_ascii_uppercase().contains(&needle)
                || item.head_ref_name.to_ascii_uppercase().contains(&needle)
        })
        .map(|item| LinkedPullRequest {
            repository: repository.into(),
            number: item.number,
            title: item.title,
            url: item.url,
            status: item.state,
            head_ref_name: item.head_ref_name,
            author_login: item.author.and_then(|author| author.login),
        })
        .collect())
}

fn github_commits(
    gh: &Path,
    client: &GithubClient,
    repository: &str,
    issue_key: &str,
) -> Result<Vec<LinkedCommit>, String> {
    let output = github_output(
        gh,
        client,
        &[
            "search",
            "commits",
            issue_key,
            "--repo",
            repository,
            "--limit",
            "30",
            "--json",
            "sha,url,commit",
        ],
    )?;
    if !output.status.success() {
        return Err("커밋을 조회하지 못했습니다.".into());
    }
    let items: Vec<GhCommitSearchResult> = serde_json::from_slice(&output.stdout)
        .map_err(|_| "커밋 응답을 읽지 못했습니다.".to_string())?;
    Ok(items
        .into_iter()
        .map(|item| LinkedCommit {
            repository: repository.into(),
            sha: item.sha,
            message: item
                .commit
                .message
                .lines()
                .next()
                .unwrap_or("제목 없는 커밋")
                .to_string(),
            url: item.url,
            author_name: item
                .commit
                .author
                .as_ref()
                .and_then(|author| author.name.clone()),
            authored_at: item.commit.author.and_then(|author| author.date),
        })
        .collect())
}

fn github_pull_request_commits(
    gh: &Path,
    client: &GithubClient,
    repository: &str,
    pull_request_number: u64,
) -> Result<Vec<LinkedCommit>, String> {
    let endpoint = format!("repos/{repository}/pulls/{pull_request_number}/commits?per_page=100");
    let output = github_output(gh, client, &["api", &endpoint])?;
    if !output.status.success() {
        return Err("PR 커밋을 조회하지 못했습니다.".into());
    }
    let items: Vec<GhPullCommitResult> = serde_json::from_slice(&output.stdout)
        .map_err(|_| "PR 커밋 응답을 읽지 못했습니다.".to_string())?;
    Ok(items
        .into_iter()
        .map(|item| LinkedCommit {
            repository: repository.into(),
            sha: item.sha,
            message: item
                .commit
                .message
                .lines()
                .next()
                .unwrap_or("제목 없는 커밋")
                .to_string(),
            url: item.html_url,
            author_name: item
                .commit
                .author
                .as_ref()
                .and_then(|author| author.name.clone()),
            authored_at: item.commit.author.and_then(|author| author.date),
        })
        .collect())
}

fn github_builds(
    gh: &Path,
    client: &GithubClient,
    repository: &str,
    branch: &str,
) -> Result<Vec<LinkedBuild>, String> {
    let output = github_output(
        gh,
        client,
        &[
            "run",
            "list",
            "--repo",
            repository,
            "--branch",
            branch,
            "--limit",
            "100",
            "--json",
            "databaseId,workflowName,displayTitle,url,status,conclusion,headBranch,createdAt",
        ],
    )?;
    if !output.status.success() {
        return Err("빌드를 조회하지 못했습니다.".into());
    }
    let items: Vec<GhWorkflowRun> = serde_json::from_slice(&output.stdout)
        .map_err(|_| "빌드 응답을 읽지 못했습니다.".to_string())?;
    Ok(items
        .into_iter()
        .map(|item| LinkedBuild {
            repository: repository.into(),
            id: item.database_id,
            name: if item.workflow_name.trim().is_empty() {
                item.display_title
            } else {
                item.workflow_name
            },
            url: item.url,
            status: item.status,
            conclusion: item.conclusion,
            branch: item.head_branch,
            created_at: item.created_at,
        })
        .collect())
}

fn github_clients(gh: &Path) -> Vec<GithubClient> {
    let Ok(output) = Command::new(gh)
        .args(["auth", "status", "--json", "hosts"])
        .output()
    else {
        return vec![GithubClient { token: None }];
    };
    let Ok(status) = serde_json::from_slice::<GhAuthStatus>(&output.stdout) else {
        return vec![GithubClient { token: None }];
    };
    let mut clients = Vec::new();
    for account in status.hosts.get("github.com").into_iter().flatten() {
        if account.state != "success" {
            continue;
        }
        let Ok(token_output) = Command::new(gh)
            .args(["auth", "token", "--user", &account.login])
            .output()
        else {
            continue;
        };
        if token_output.status.success() {
            let token = String::from_utf8_lossy(&token_output.stdout)
                .trim()
                .to_string();
            if !token.is_empty() {
                clients.push(GithubClient { token: Some(token) });
            }
        }
    }
    if clients.is_empty() {
        clients.push(GithubClient { token: None });
    }
    clients
}

fn discover_issue_repositories(
    gh: &Path,
    client: &GithubClient,
    issue_key: &str,
) -> Result<Vec<String>, String> {
    let mut repositories = HashSet::new();
    for entity in ["prs", "commits"] {
        let output = github_output(
            gh,
            client,
            &[
                "search",
                entity,
                issue_key,
                "--limit",
                "100",
                "--json",
                "repository",
            ],
        )?;
        if !output.status.success() {
            continue;
        }
        let items: Vec<GhRepositorySearchItem> = serde_json::from_slice(&output.stdout)
            .map_err(|_| "GitHub 저장소 검색 응답을 읽지 못했습니다.".to_string())?;
        repositories.extend(
            items
                .into_iter()
                .map(|item| item.repository.name_with_owner),
        );
    }
    Ok(repositories.into_iter().take(MAX_REPOSITORIES).collect())
}

fn github_output(
    gh: &Path,
    client: &GithubClient,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let mut command = Command::new(gh);
    command.args(args);
    if let Some(token) = &client.token {
        command.env("GH_TOKEN", token);
    }
    command
        .output()
        .map_err(|_| "GitHub CLI 명령을 실행하지 못했습니다.".to_string())
}

fn deduplicate_pull_requests(items: &mut Vec<LinkedPullRequest>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert((item.repository.clone(), item.number)));
}

fn deduplicate_commits(items: &mut Vec<LinkedCommit>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert((item.repository.clone(), item.sha.clone())));
}

fn warnings_push_unique(warnings: &mut Vec<String>, message: String) {
    if !warnings.contains(&message) {
        warnings.push(message);
    }
}

fn discover_repositories(cwds: Vec<String>) -> Result<Vec<String>, String> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .and_then(|path| path.canonicalize().ok())
        .ok_or_else(|| "사용자 홈 디렉터리를 확인할 수 없습니다.".to_string())?;
    let git = find_executable(
        "git",
        &[
            "/usr/bin/git",
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
        ],
    )
    .ok_or_else(|| "Git 실행 파일을 찾을 수 없습니다.".to_string())?;
    let mut repositories = Vec::new();
    let mut seen_directories = HashSet::new();
    let mut seen_repositories = HashSet::new();
    for cwd in cwds.into_iter().take(MAX_SESSION_DIRECTORIES) {
        let Ok(directory) = PathBuf::from(cwd).canonicalize() else {
            continue;
        };
        if !directory.is_dir()
            || !directory.starts_with(&home)
            || !seen_directories.insert(directory.clone())
        {
            continue;
        }
        let Some(root) = command_text(
            &git,
            &["-C", path_text(&directory), "rev-parse", "--show-toplevel"],
        ) else {
            continue;
        };
        let Some(remote) = command_text(&git, &["-C", &root, "remote", "get-url", "origin"]) else {
            continue;
        };
        let Some(repository) = github_repository_slug(&remote) else {
            continue;
        };
        if seen_repositories.insert(repository.clone()) {
            repositories.push(repository);
        }
        if repositories.len() >= MAX_REPOSITORIES {
            break;
        }
    }
    Ok(repositories)
}

fn normalize_issue_key(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_uppercase();
    let Some((project, number)) = value.split_once('-') else {
        return Err("올바른 Jira 이슈 키를 입력해주세요.".into());
    };
    if project.len() < 2
        || !project
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        || number.is_empty()
        || !number.chars().all(|character| character.is_ascii_digit())
    {
        return Err("올바른 Jira 이슈 키를 입력해주세요.".into());
    }
    Ok(value)
}

pub(crate) fn validate_jira_cloud_url(value: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(value.trim())
        .map_err(|_| "Jira 사이트 URL을 확인해주세요.".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() != "https" || !(host == "atlassian.net" || host.ends_with(".atlassian.net")) {
        return Err("Jira Cloud의 https://*.atlassian.net URL만 지원합니다.".into());
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn command_text(executable: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(executable).args(args).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn path_text(path: &Path) -> &str {
    path.to_str().unwrap_or("")
}

fn find_executable(name: &str, known_paths: &[&str]) -> Option<PathBuf> {
    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    known_paths
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn github_repository_slug(remote: &str) -> Option<String> {
    let trimmed = remote.trim().trim_end_matches('/').trim_end_matches(".git");
    let path = trimmed
        .strip_prefix("git@github.com:")
        .or_else(|| trimmed.strip_prefix("ssh://git@github.com/"))
        .or_else(|| trimmed.strip_prefix("https://github.com/"))
        .or_else(|| trimmed.strip_prefix("http://github.com/"))?;
    let mut parts = path.split('/');
    let owner = parts.next()?.trim();
    let repository = parts.next()?.trim();
    (!owner.is_empty() && !repository.is_empty() && parts.next().is_none())
        .then(|| format!("{owner}/{repository}"))
}

#[cfg(test)]
mod tests {
    use super::{normalize_issue_key, validate_jira_cloud_url, GhRepositorySearchItem};

    #[test]
    fn validates_jira_issue_keys() {
        assert_eq!(normalize_issue_key(" cgkr-123 ").unwrap(), "CGKR-123");
        assert!(normalize_issue_key("not-a-key").is_err());
    }

    #[test]
    fn only_accepts_atlassian_cloud_urls() {
        assert!(validate_jira_cloud_url("https://team.atlassian.net").is_ok());
        assert!(validate_jira_cloud_url("https://example.com").is_err());
    }

    #[test]
    fn parses_repository_from_github_search_results() {
        let items: Vec<GhRepositorySearchItem> = serde_json::from_str(
            r#"[{"repository":{"name":"cgkr_mobile_ui","nameWithOwner":"colosseumcoinckr/cgkr_mobile_ui"}}]"#,
        )
        .unwrap();
        assert_eq!(
            items[0].repository.name_with_owner,
            "colosseumcoinckr/cgkr_mobile_ui"
        );
    }
}
