# [ADR-007] Google Calendar에 공용 데스크톱 OAuth 클라이언트 사용

- 상태: Accepted

| 항목 | 내용 |
| --- | --- |
| 참여자 | Orbit maintainer |
| 결정자 | Orbit maintainer |
| 참고자 | Google OAuth native app guidance |
| 논의일자 | 2026-08-12 |
| 적용일자 | 2026-08-12 |
| 만료일자 | - |
| 대체문서 | - |

## Background

기존 Google Calendar 설정은 각 사용자에게 OAuth Client ID와 선택적인 Client Secret 입력을 요구했다. 이 방식은 일반 사용자가 Google Cloud 프로젝트와 동의 화면을 직접 구성해야 하므로 배포 제품의 연결 경험으로 적합하지 않다. 또한 설치형 앱에 client secret을 포함해도 사용자가 실행 파일을 소유하므로 비밀을 보장할 수 없다.

## Decision

Orbit이 관리하는 External 유형의 데스크톱 OAuth Client ID 하나를 배포본에 포함한다. 로그인은 시스템 브라우저, loopback redirect와 PKCE를 사용한다. 각 사용자의 authorization code와 refresh token은 서로 분리되며 refresh token만 macOS Keychain에 저장한다. 앱은 Google Calendar event 읽기 권한만 요청하고 Google 원본을 수정하거나 삭제하지 않는다.

사용자용 Settings에서는 Client ID와 Client Secret 입력란을 제거한다. 사용자는 `Google 계정 연결`만 선택한다. 연결 해제는 Orbit의 로컬 token과 동기화 캐시를 삭제하며 Google Calendar 원본을 변경하지 않는다.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| Orbit 공용 데스크톱 Client ID + PKCE | 일반 사용자가 즉시 로그인할 수 있고 사용자별 token이 분리됨 | 공개 앱의 branding·scope 검증과 운영 책임 필요 |
| 사용자별 Google Cloud Client ID 입력 | Orbit이 OAuth 앱을 운영하지 않아도 됨 | 설정 장벽이 높고 일반 사용자 배포에 부적합 |
| Client Secret을 앱에 포함 | 웹 서버 방식과 비슷하게 보임 | 설치형 앱에서는 secret을 보호할 수 없어 보안상 의미 없음 |
| Embedded WebView 로그인 | 앱 안에서 흐름이 끝남 | native OAuth 권장 흐름과 맞지 않고 provider 정책 위험이 있음 |

**최종 결정:** 공용 데스크톱 Client ID와 시스템 브라우저 PKCE 흐름을 사용한다.

## Consequences

- Google Cloud OAuth 동의 화면, 개인정보처리방침과 scope 검증을 Orbit 배포 책임으로 관리한다.
- Client ID는 공개 식별자이므로 저장소와 배포본에 포함할 수 있지만 refresh token은 절대 포함하지 않는다.
- OAuth 앱 설정이 잘못된 배포본은 사용자에게 연결 불가 오류를 명확히 보여야 한다.
- scope 확대가 필요하면 이 ADR과 인증정보 정책을 다시 검토한다.

## Reference

- `src-tauri/src/google_calendar.rs`
- `src/pages/settings/SettingsPage.tsx`
- [인증정보와 보안 정책](../policies/credential-security-policy.md)
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/workspace/calendar/api/auth
