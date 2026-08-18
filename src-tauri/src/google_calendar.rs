use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USER_INFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
const EVENTS_URL: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CALENDAR_SCOPE: &str =
    "openid email https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_OAUTH_CLIENT_ID: &str =
    "995704849590-4mv8lvi66s9b9jbgc5vl1krab1a0ic20.apps.googleusercontent.com";
const GOOGLE_OAUTH_CLIENT_SECRET: Option<&str> = option_env!("ORBIT_GOOGLE_OAUTH_CLIENT_SECRET");
const REFRESH_TOKEN_SECRET_ID: &str = "google_refresh_token";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthResult {
    email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarSyncResult {
    events: Vec<GoogleCalendarEvent>,
    next_sync_token: Option<String>,
    reset_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarEvent {
    id: String,
    title: String,
    status: String,
    start_date_time: Option<String>,
    start_date: Option<String>,
    end_date_time: Option<String>,
    end_date: Option<String>,
    html_link: Option<String>,
    location: Option<String>,
    notes: Option<String>,
    updated: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct UserInfoResponse {
    email: String,
}

#[derive(Deserialize)]
struct EventListResponse {
    #[serde(default)]
    items: Vec<GoogleEventResponse>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
    #[serde(rename = "nextSyncToken")]
    next_sync_token: Option<String>,
}

#[derive(Deserialize)]
struct GoogleEventResponse {
    id: String,
    #[serde(default)]
    summary: String,
    #[serde(default = "confirmed_status")]
    status: String,
    start: Option<GoogleEventDateTime>,
    end: Option<GoogleEventDateTime>,
    #[serde(rename = "htmlLink")]
    html_link: Option<String>,
    location: Option<String>,
    description: Option<String>,
    updated: Option<String>,
}

#[derive(Deserialize)]
struct GoogleEventDateTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

fn confirmed_status() -> String {
    "confirmed".into()
}

#[tauri::command]
pub async fn connect_google_calendar(app: AppHandle) -> Result<GoogleOAuthResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("Google 로그인 콜백 포트를 열지 못했습니다. ({error})"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let redirect_uri = format!(
            "http://127.0.0.1:{}",
            listener.local_addr().map_err(|e| e.to_string())?.port()
        );
        let state = random_base64url(24)?;
        let verifier = random_base64url(48)?;
        let challenge = base64url(&sha256(verifier.as_bytes()));

        let mut auth_url = reqwest::Url::parse(AUTH_URL).map_err(|error| error.to_string())?;
        auth_url
            .query_pairs_mut()
            .append_pair("client_id", GOOGLE_OAUTH_CLIENT_ID)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", CALENDAR_SCOPE)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("include_granted_scopes", "true")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");

        app.opener()
            .open_url(auth_url.as_str(), None::<&str>)
            .map_err(|error| format!("Google 로그인 브라우저를 열지 못했습니다. ({error})"))?;

        let code = wait_for_oauth_callback(listener, &redirect_uri, &state)?;
        let client = http_client()?;
        let mut form = vec![
            ("client_id", GOOGLE_OAUTH_CLIENT_ID.to_string()),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code".into()),
            ("redirect_uri", redirect_uri),
        ];
        append_google_client_secret(&mut form)?;
        let token: TokenResponse = send_token_request(&client, &form)?;
        let refresh_token = token.refresh_token.ok_or_else(|| {
            "Google에서 갱신 토큰을 보내지 않았습니다. 연결을 해제한 뒤 다시 로그인해주세요."
                .to_string()
        })?;
        super::set_internal_secret(REFRESH_TOKEN_SECRET_ID, &refresh_token)?;

        let user_info = client
            .get(USER_INFO_URL)
            .bearer_auth(&token.access_token)
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("Google 계정 정보를 확인하지 못했습니다. ({error})"))?
            .json::<UserInfoResponse>()
            .map_err(|error| format!("Google 계정 응답을 읽지 못했습니다. ({error})"))?;

        Ok(GoogleOAuthResult {
            email: user_info.email,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn sync_google_calendar(
    sync_token: Option<String>,
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<GoogleCalendarSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let refresh_token = super::get_secret(REFRESH_TOKEN_SECRET_ID)?;
        let client = http_client()?;
        let mut form = vec![
            ("client_id", GOOGLE_OAUTH_CLIENT_ID.to_string()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token".into()),
        ];
        append_google_client_secret(&mut form)?;
        let token: TokenResponse = send_token_request(&client, &form)?;
        fetch_events(&client, &token.access_token, sync_token, time_min, time_max)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn disconnect_google_calendar() -> Result<(), String> {
    super::delete_internal_secret(REFRESH_TOKEN_SECRET_ID)
}

fn fetch_events(
    client: &Client,
    access_token: &str,
    sync_token: Option<String>,
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<GoogleCalendarSyncResult, String> {
    let mut page_token: Option<String> = None;
    let mut events = Vec::new();
    let next_sync_token;

    loop {
        let mut url = reqwest::Url::parse(EVENTS_URL).map_err(|error| error.to_string())?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("maxResults", "2500");
            query.append_pair("showDeleted", "true");
            query.append_pair("singleEvents", "true");
            if let Some(token) = sync_token.as_ref() {
                query.append_pair("syncToken", token);
            } else {
                query.append_pair("orderBy", "startTime");
                if let Some(value) = time_min.as_ref() {
                    query.append_pair("timeMin", value);
                }
                if let Some(value) = time_max.as_ref() {
                    query.append_pair("timeMax", value);
                }
            }
            if let Some(token) = page_token.as_ref() {
                query.append_pair("pageToken", token);
            }
        }

        let response = client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .map_err(|error| format!("Google Calendar에 연결하지 못했습니다. ({error})"))?;
        if response.status().as_u16() == 410 {
            return Ok(GoogleCalendarSyncResult {
                events: vec![],
                next_sync_token: None,
                reset_required: true,
            });
        }
        let page = response
            .error_for_status()
            .map_err(|error| format!("Google Calendar 일정을 가져오지 못했습니다. ({error})"))?
            .json::<EventListResponse>()
            .map_err(|error| format!("Google Calendar 응답을 읽지 못했습니다. ({error})"))?;

        events.extend(page.items.into_iter().map(|event| {
            GoogleCalendarEvent {
                id: event.id,
                title: if event.summary.trim().is_empty() {
                    "제목 없는 일정".into()
                } else {
                    event.summary
                },
                status: event.status,
                start_date_time: event
                    .start
                    .as_ref()
                    .and_then(|value| value.date_time.clone()),
                start_date: event.start.as_ref().and_then(|value| value.date.clone()),
                end_date_time: event.end.as_ref().and_then(|value| value.date_time.clone()),
                end_date: event.end.as_ref().and_then(|value| value.date.clone()),
                html_link: event.html_link,
                location: event.location,
                notes: event.description,
                updated: event.updated,
            }
        }));
        page_token = page.next_page_token;
        if page_token.is_none() {
            next_sync_token = page.next_sync_token;
            break;
        }
    }

    Ok(GoogleCalendarSyncResult {
        events,
        next_sync_token,
        reset_required: false,
    })
}

fn send_token_request(client: &Client, form: &[(&str, String)]) -> Result<TokenResponse, String> {
    let response = client
        .post(TOKEN_URL)
        .form(form)
        .send()
        .map_err(|error| format!("Google 인증 서버에 연결하지 못했습니다. ({error})"))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().unwrap_or_default();
        if detail.contains("client_secret is missing") {
            return Err(
                "Google OAuth 클라이언트 자격증명이 이 빌드에 없습니다. 배포 설정을 확인해주세요."
                    .into(),
            );
        }
        return Err(format!(
            "Google 인증에 실패했습니다. ({status}: {})",
            compact_error(&detail)
        ));
    }
    response
        .json::<TokenResponse>()
        .map_err(|error| format!("Google 인증 응답을 읽지 못했습니다. ({error})"))
}

fn append_google_client_secret(form: &mut Vec<(&str, String)>) -> Result<(), String> {
    let secret = GOOGLE_OAUTH_CLIENT_SECRET
        .map(str::to_owned)
        .or(super::get_optional_secret("google_client_secret")?)
        .filter(|value| !value.trim().is_empty());
    if let Some(secret) = secret {
        form.push(("client_secret", secret));
    }
    Ok(())
}

fn wait_for_oauth_callback(
    listener: TcpListener,
    redirect_uri: &str,
    expected_state: &str,
) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 8192];
                let size = stream
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..size]);
                let path = request
                    .split_whitespace()
                    .nth(1)
                    .ok_or("잘못된 OAuth 콜백입니다.")?;
                let callback = reqwest::Url::parse(&format!("{redirect_uri}{path}"))
                    .map_err(|error| error.to_string())?;
                let params = callback
                    .query_pairs()
                    .collect::<std::collections::HashMap<_, _>>();
                let error = params.get("error").map(|value| value.to_string());
                let state = params
                    .get("state")
                    .map(|value| value.as_ref())
                    .unwrap_or("");
                let valid_state = state == expected_state;
                let code = params.get("code").map(|value| value.to_string());
                let success = error.is_none() && valid_state && code.is_some();
                let body = if success {
                    "<h2>Google Calendar가 Orbit에 연결되었습니다.</h2><p>이 창을 닫고 Orbit으로 돌아가세요.</p>"
                } else {
                    "<h2>Google Calendar 연결에 실패했습니다.</h2><p>Orbit으로 돌아가 다시 시도하세요.</p>"
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                let _ = stream.write_all(response.as_bytes());
                if let Some(error) = error {
                    return Err(format!(
                        "Google 로그인이 취소되었거나 거부되었습니다. ({error})"
                    ));
                }
                if !valid_state {
                    return Err("Google 로그인 응답의 보안 검증에 실패했습니다.".into());
                }
                return code.ok_or_else(|| "Google 로그인 코드가 없습니다.".into());
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Google 로그인이 3분 안에 완료되지 않았습니다.".into())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

fn compact_error(value: &str) -> String {
    value.chars().take(240).collect()
}

fn random_base64url(size: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; size];
    File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| format!("보안 난수를 만들지 못했습니다. ({error})"))?;
    Ok(base64url(&bytes))
}

fn base64url(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::new();
    for chunk in input.chunks(3) {
        let value = ((chunk[0] as u32) << 16)
            | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8)
            | chunk.get(2).copied().unwrap_or(0) as u32;
        output.push(TABLE[((value >> 18) & 63) as usize] as char);
        output.push(TABLE[((value >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            output.push(TABLE[((value >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            output.push(TABLE[(value & 63) as usize] as char);
        }
    }
    output
}

fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut data = input.to_vec();
    let bit_len = (data.len() as u64) * 8;
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());
    let mut h = [
        0x6a09e667_u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    for block in data.chunks(64) {
        let mut w = [0_u32; 64];
        for (index, word) in block.chunks(4).take(16).enumerate() {
            w[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (target, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *target = target.wrapping_add(value);
        }
    }
    let mut output = [0_u8; 32];
    for (chunk, value) in output.chunks_mut(4).zip(h) {
        chunk.copy_from_slice(&value.to_be_bytes());
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_and_base64url_match_pkce_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            base64url(&sha256(verifier.as_bytes())),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn shared_google_client_id_uses_google_oauth_format() {
        assert!(GOOGLE_OAUTH_CLIENT_ID.ends_with(".apps.googleusercontent.com"));
    }
}
