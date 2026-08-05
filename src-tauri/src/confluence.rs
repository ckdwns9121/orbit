use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceSearchResult {
    cql: String,
    pages: Vec<ConfluencePage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfluencePage {
    id: String,
    title: String,
    space_key: String,
    excerpt: String,
    url: String,
    last_modified: String,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SearchItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchItem {
    content: Option<SearchContent>,
    title: Option<String>,
    excerpt: Option<String>,
    url: Option<String>,
    last_modified: Option<String>,
}

#[derive(Deserialize)]
struct SearchContent {
    id: String,
    title: String,
    space: Option<SearchSpace>,
    version: Option<SearchVersion>,
    #[serde(rename = "_links")]
    links: Option<SearchLinks>,
}

#[derive(Deserialize)]
struct SearchSpace {
    key: String,
}

#[derive(Deserialize)]
struct SearchVersion {
    when: Option<String>,
}

#[derive(Deserialize)]
struct SearchLinks {
    webui: Option<String>,
}

#[tauri::command]
pub async fn search_confluence_pages(
    jira_url: String,
    jira_email: String,
    cql: String,
) -> Result<ConfluenceSearchResult, String> {
    let cql = cql.trim().chars().take(500).collect::<String>();
    if cql.is_empty() {
        return Err("Confluence에서 검색할 조건을 찾지 못했습니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || search(jira_url, jira_email, cql))
        .await
        .map_err(|_| "Confluence 검색이 중단되었습니다.".to_string())?
}

fn search(
    jira_url: String,
    jira_email: String,
    cql: String,
) -> Result<ConfluenceSearchResult, String> {
    let base_url = super::jira_issue::validate_jira_cloud_url(&jira_url)?;
    if jira_email.trim().is_empty() {
        return Err("Settings에서 Atlassian 계정 이메일을 입력해주세요.".into());
    }
    let token = super::get_secret("jira_api_token")?;
    let endpoint = base_url
        .join("wiki/rest/api/search")
        .map_err(|_| "Confluence 검색 URL을 만들지 못했습니다.".to_string())?;
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .get(endpoint)
        .basic_auth(jira_email.trim(), Some(token))
        .query(&[
            ("cql", cql.as_str()),
            ("limit", "40"),
            ("expand", "content.space,content.version"),
        ])
        .send()
        .map_err(|error| format!("Confluence 문서를 검색하지 못했습니다. ({error})"))?;

    let status = response.status();
    if !status.is_success() {
        let help = match status.as_u16() {
            400 => " 검색 조건을 이해하지 못했습니다.",
            401 | 403 => " Atlassian 계정 또는 Confluence 열람 권한을 확인해주세요.",
            404 => " 이 Atlassian 사이트에서 Confluence를 찾지 못했습니다.",
            _ => "",
        };
        return Err(format!("Confluence 검색에 실패했습니다. ({status}){help}"));
    }

    let response = response
        .json::<SearchResponse>()
        .map_err(|error| format!("Confluence 검색 응답을 읽지 못했습니다. ({error})"))?;
    let pages = response
        .results
        .into_iter()
        .filter_map(|item| {
            let content = item.content?;
            let webui = content
                .links
                .and_then(|links| links.webui)
                .or(item.url)
                .unwrap_or_else(|| format!("/wiki/pages/viewpage.action?pageId={}", content.id));
            let url = base_url
                .join(webui.trim_start_matches('/'))
                .ok()?
                .to_string();
            Some(ConfluencePage {
                id: content.id,
                title: item.title.unwrap_or(content.title),
                space_key: content.space.map(|space| space.key).unwrap_or_default(),
                excerpt: plain_text(&item.excerpt.unwrap_or_default()),
                url,
                last_modified: item
                    .last_modified
                    .or_else(|| content.version.and_then(|version| version.when))
                    .unwrap_or_default(),
            })
        })
        .collect();
    Ok(ConfluenceSearchResult { cql, pages })
}

fn plain_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut inside_tag = false;
    for character in value.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }
    output
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(4_000)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{plain_text, SearchResponse};

    #[test]
    fn parses_search_results_and_removes_excerpt_markup() {
        let response: SearchResponse = serde_json::from_str(
            r#"{"results":[{"content":{"id":"123","title":"Runbook","space":{"key":"DEV"},"version":{"when":"2024-03-15T10:00:00.000Z"},"_links":{"webui":"/spaces/DEV/pages/123"}},"excerpt":"<b>온콜</b>&nbsp;대응","lastModified":"2024-03-15T10:00:00.000Z"}]}"#,
        )
        .expect("valid Confluence response");
        assert_eq!(response.results.len(), 1);
        assert_eq!(
            plain_text(response.results[0].excerpt.as_deref().unwrap()),
            "온콜 대응"
        );
    }
}
