use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Command,
};

const MAX_SESSION_DIRECTORIES: usize = 100;
const MAX_REPOSITORIES: usize = 20;
const MAX_PULL_REQUESTS_PER_REPOSITORY: usize = 50;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPullRequest {
    repository: String,
    repo_path: String,
    number: u64,
    title: String,
    url: String,
    head_ref_name: String,
    base_ref_name: String,
    is_draft: bool,
    updated_at: String,
    author_login: Option<String>,
    session_match_count: usize,
    authored_by_viewer: bool,
    review_requested: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestScanResult {
    pull_requests: Vec<DiscoveredPullRequest>,
    repositories_scanned: usize,
    repositories_succeeded: usize,
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequest {
    number: u64,
    title: String,
    url: String,
    head_ref_name: String,
    base_ref_name: String,
    #[serde(default)]
    is_draft: bool,
    updated_at: String,
    author: Option<GhAuthor>,
}

#[derive(Debug, Deserialize)]
struct GhAuthor {
    login: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhSearchPullRequest {
    number: u64,
    title: String,
    url: String,
    #[serde(default)]
    is_draft: bool,
    updated_at: String,
    author: Option<GhAuthor>,
    repository: GhRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhRepository {
    name_with_owner: String,
}

#[derive(Debug)]
struct RepositoryContext {
    path: PathBuf,
    branches: HashMap<String, usize>,
}

#[tauri::command]
pub async fn scan_session_pull_requests(
    cwds: Vec<String>,
) -> Result<PullRequestScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan(cwds))
        .await
        .map_err(|_| "Pull Request 검색 작업이 중단되었습니다.".to_string())?
}

fn scan(cwds: Vec<String>) -> Result<PullRequestScanResult, String> {
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
    let gh =
        find_executable("gh", &["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]).ok_or_else(|| {
            "GitHub CLI(gh)를 찾을 수 없습니다. gh를 설치하고 로그인해주세요.".to_string()
        })?;

    let mut repositories: HashMap<String, RepositoryContext> = HashMap::new();
    let mut resolved_directories: HashMap<PathBuf, (String, PathBuf, String)> = HashMap::new();
    let mut non_repository_directories = HashSet::new();

    for cwd in cwds.into_iter().take(MAX_SESSION_DIRECTORIES) {
        let Ok(directory) = PathBuf::from(cwd).canonicalize() else {
            continue;
        };
        if !directory.is_dir() || !directory.starts_with(&home) {
            continue;
        }
        if non_repository_directories.contains(&directory) {
            continue;
        }

        if let Some((repository, root, branch)) = resolved_directories.get(&directory).cloned() {
            let context = repositories
                .entry(repository)
                .or_insert_with(|| RepositoryContext {
                    path: root,
                    branches: HashMap::new(),
                });
            if !branch.is_empty() {
                *context.branches.entry(branch).or_default() += 1;
            }
            continue;
        }

        let Some(root_text) = command_text(
            &git,
            &["-C", path_text(&directory), "rev-parse", "--show-toplevel"],
        ) else {
            non_repository_directories.insert(directory);
            continue;
        };
        let Ok(root) = PathBuf::from(root_text).canonicalize() else {
            continue;
        };
        if !root.starts_with(&home) {
            continue;
        }
        let Some(remote) = command_text(
            &git,
            &["-C", path_text(&root), "remote", "get-url", "origin"],
        ) else {
            continue;
        };
        let Some(repository) = github_repository_slug(&remote) else {
            continue;
        };
        let branch = command_text(&git, &["-C", path_text(&root), "branch", "--show-current"])
            .unwrap_or_default();
        resolved_directories.insert(
            directory,
            (repository.clone(), root.clone(), branch.clone()),
        );
        let context = repositories
            .entry(repository)
            .or_insert_with(|| RepositoryContext {
                path: root,
                branches: HashMap::new(),
            });
        if !branch.is_empty() {
            *context.branches.entry(branch).or_default() += 1;
        }
    }

    let mut repositories = repositories.into_iter().collect::<Vec<_>>();
    repositories.sort_by(|left, right| left.0.cmp(&right.0));
    repositories.truncate(MAX_REPOSITORIES);

    let mut pull_requests = Vec::new();
    let mut warnings = Vec::new();
    let mut repositories_succeeded = 0;
    for (repository, context) in &repositories {
        let authored = fetch_pull_requests(&gh, repository, &["--author", "@me"]);
        let Ok(items) = authored else {
            warnings.push(format!(
                "{repository}: PR을 불러오지 못했습니다. gh 로그인을 확인해주세요."
            ));
            continue;
        };
        repositories_succeeded += 1;

        for item in items {
            pull_requests.push(DiscoveredPullRequest {
                session_match_count: context
                    .branches
                    .get(&item.head_ref_name)
                    .copied()
                    .unwrap_or(0),
                repository: repository.clone(),
                repo_path: context.path.to_string_lossy().into_owned(),
                number: item.number,
                title: item.title,
                url: item.url,
                head_ref_name: item.head_ref_name,
                base_ref_name: item.base_ref_name,
                is_draft: item.is_draft,
                updated_at: item.updated_at,
                author_login: item.author.and_then(|author| author.login),
                authored_by_viewer: true,
                review_requested: false,
            });
        }
    }

    match fetch_review_requests(&gh) {
        Ok(items) => merge_review_requests(&mut pull_requests, items),
        Err(()) => warnings.push(
            "GitHub 전체에서 내 리뷰 대기 PR을 불러오지 못했습니다. gh 로그인을 확인해주세요."
                .to_string(),
        ),
    }

    pull_requests.sort_by(|left, right| {
        right
            .session_match_count
            .cmp(&left.session_match_count)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });

    Ok(PullRequestScanResult {
        pull_requests,
        repositories_scanned: repositories.len(),
        repositories_succeeded,
        warnings,
    })
}

fn fetch_review_requests(gh: &Path) -> Result<Vec<GhSearchPullRequest>, ()> {
    let limit = MAX_PULL_REQUESTS_PER_REPOSITORY.to_string();
    let output = Command::new(gh)
        .args([
            "search",
            "prs",
            "--review-requested",
            "@me",
            "--state",
            "open",
            "--limit",
            &limit,
            "--json",
            "number,title,url,isDraft,updatedAt,author,repository",
        ])
        .output()
        .map_err(|_| ())?;
    if !output.status.success() {
        return Err(());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| ())
}

fn merge_review_requests(
    pull_requests: &mut Vec<DiscoveredPullRequest>,
    review_requests: Vec<GhSearchPullRequest>,
) {
    for item in review_requests {
        if let Some(existing) = pull_requests.iter_mut().find(|pull| pull.url == item.url) {
            existing.review_requested = true;
            continue;
        }
        pull_requests.push(DiscoveredPullRequest {
            repository: item.repository.name_with_owner,
            repo_path: String::new(),
            number: item.number,
            title: item.title,
            url: item.url,
            head_ref_name: String::new(),
            base_ref_name: String::new(),
            is_draft: item.is_draft,
            updated_at: item.updated_at,
            author_login: item.author.and_then(|author| author.login),
            session_match_count: 0,
            authored_by_viewer: false,
            review_requested: true,
        });
    }
}

fn fetch_pull_requests(
    gh: &Path,
    repository: &str,
    filter_args: &[&str],
) -> Result<Vec<GhPullRequest>, ()> {
    let limit = MAX_PULL_REQUESTS_PER_REPOSITORY.to_string();
    let mut args = vec!["pr", "list", "--repo", repository, "--state", "open"];
    args.extend_from_slice(filter_args);
    args.extend_from_slice(&[
        "--limit",
        &limit,
        "--json",
        "number,title,url,headRefName,baseRefName,isDraft,updatedAt,author",
    ]);
    let output = Command::new(gh).args(args).output().map_err(|_| ())?;
    if !output.status.success() {
        return Err(());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| ())
}

fn command_text(executable: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(executable).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!value.is_empty()).then_some(value)
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
    let path = if let Some(value) = trimmed.strip_prefix("git@github.com:") {
        value
    } else if let Some(value) = trimmed.strip_prefix("ssh://git@github.com/") {
        value
    } else if let Some(value) = trimmed.strip_prefix("https://github.com/") {
        value
    } else if let Some(value) = trimmed.strip_prefix("http://github.com/") {
        value
    } else {
        return None;
    };
    let mut parts = path.split('/');
    let owner = parts.next()?.trim();
    let repository = parts.next()?.trim();
    if owner.is_empty() || repository.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repository}"))
}

#[cfg(test)]
mod tests {
    use super::github_repository_slug;

    #[test]
    fn parses_supported_github_remotes() {
        assert_eq!(
            github_repository_slug("git@github.com:acme/orbit.git"),
            Some("acme/orbit".into())
        );
        assert_eq!(
            github_repository_slug("https://github.com/acme/orbit.git"),
            Some("acme/orbit".into())
        );
        assert_eq!(
            github_repository_slug("ssh://git@github.com/acme/orbit"),
            Some("acme/orbit".into())
        );
    }

    #[test]
    fn rejects_non_github_and_nested_paths() {
        assert_eq!(
            github_repository_slug("https://gitlab.com/acme/orbit.git"),
            None
        );
        assert_eq!(
            github_repository_slug("https://github.com/acme/orbit/extra"),
            None
        );
    }
}
