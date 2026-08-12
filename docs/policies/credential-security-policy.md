# 인증정보와 보안 정책

- 상태: Accepted

## 정책

1. API token, OAuth refresh token, client secret과 AI API key는 macOS Keychain에 저장한다.
2. SQLite, localStorage, activity event, completion evidence와 Context Graph에는 secret 원문을 저장하지 않는다.
3. 로그·오류·검색 인덱스에 들어가는 credential 패턴은 저장 전에 마스킹한다.
4. 설정 UI는 저장된 secret 원문을 다시 읽어 화면에 표시하지 않고 설정 여부만 보여준다.
5. 외부 로그인은 시스템 브라우저와 native app OAuth 흐름을 사용하며 embedded webview 로그인을 사용하지 않는다.
6. 배포 빌드는 안정된 Apple 코드서명을 사용한다. ad-hoc 개발 빌드의 Keychain 반복 승인은 제품의 정상 인증 경험으로 간주하지 않는다.
7. secret 삭제는 해당 provider 연결 상태와 process cache를 함께 무효화한다.

## 근거

- `src-tauri/src/lib.rs`
- `src/entities/work-context/api/completion-repository.ts`
- `src/entities/work-context/api/context-graph-repository.ts`
