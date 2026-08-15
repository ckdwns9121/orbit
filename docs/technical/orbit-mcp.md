# Orbit MCP와 터미널 스킬

## 목적

Orbit MCP는 Claude Code와 Codex가 Orbit의 로컬 업무 데이터에 접근하는 단일 경계다. 스킬은 사용자의 짧은 명령을 MCP 도구 호출 절차로 바꾸고, MCP 서버는 입력 검증과 SQLite 접근을 담당한다.

```text
사용자 명령
  ├─ Claude: /orbit:create-todo, /orbit:my-ticket
  └─ Codex:  $orbit-create-todo, $orbit-my-ticket
        ↓
클라이언트별 Agent Skill
        ↓
Orbit STDIO MCP
  ├─ create_task       로컬 Orbit 할 일 생성
  ├─ list_tasks        로컬 Orbit 할 일 조회
  └─ list_my_tickets   동기화된 Jira 캐시와 연결 작업 조회
        ↓
Orbit SQLite
```

MCP 서버는 기본적으로 운영체제별 Orbit 앱 데이터 디렉터리의 `orbit.db`를 찾는다. 테스트나 별도 설치에서는 `ORBIT_DB_PATH`로 경로를 덮어쓸 수 있다. `ORBIT_MCP_READ_ONLY=1`이면 모든 생성 요청을 거부한다.

## 로컬 검증

```bash
bun run mcp:test
bun run mcp:validate
```

`mcp:validate`는 Claude 플러그인에 포함할 단일 서버 번들을 만든 뒤 플러그인 구조를 검사한다.

## Claude Code

개발 중인 플러그인을 직접 로드한다.

```bash
cd /path/to/orbit
bun run mcp:bundle
claude --plugin-dir ./agent-plugins/orbit
```

Claude Code 안에서 다음 명령을 사용할 수 있다.

```text
/orbit:create-todo 내일 오전까지 배포 체크리스트 정리
/orbit:my-ticket Sentry
```

플러그인이 활성화되면 포함된 STDIO MCP 서버도 자동으로 시작된다. `/mcp`에서 `orbit` 연결과 도구를 확인한다.

사용자 범위에 계속 설치하려면 로컬 marketplace를 등록한다.

```bash
claude plugin marketplace add /absolute/path/to/orbit --scope user
claude plugin install orbit@orbit-local --scope user
```

설치 후 새 Claude Code 세션부터 `--plugin-dir` 없이 동일한 `/orbit:*` 명령을 사용할 수 있다.

## Codex

Codex는 저장소의 `.agents/skills`에서 두 스킬을 자동으로 발견한다. MCP 서버는 한 번 등록한다.

```bash
cd /path/to/orbit
codex mcp add orbit -- bun run /absolute/path/to/orbit/mcp/server.ts
codex mcp list
```

Codex CLI에서는 다음처럼 명시적으로 호출한다.

```text
$orbit-create-todo 내일 오전까지 배포 체크리스트 정리
$orbit-my-ticket Sentry
```

다른 저장소에서도 스킬을 사용하려면 두 스킬 디렉터리를 `~/.agents/skills/` 아래에 복사하거나 심볼릭 링크한다. MCP 설정은 사용자 범위의 `~/.codex/config.toml`에 저장되므로 한 번 등록하면 모든 로컬 프로젝트에서 사용할 수 있다.

## 안전 경계

- `create_task`만 쓰기 도구다. Jira, Slack, GitHub의 원격 상태는 변경하지 않는다.
- `list_my_tickets`는 Orbit 앱이 마지막으로 동기화한 Jira 캐시를 읽는다.
- 비밀 정보는 MCP 입력이나 stdout 로그에 출력하지 않는다. STDIO의 stdout은 MCP 프로토콜 전용이다.
- 긴 목록은 최대 100개로 제한한다.
- 공개 배포 전에는 버전이 고정된 플러그인 패키지와 설치 흐름을 별도로 제공한다.
