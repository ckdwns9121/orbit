# Task 생명주기 정책

- 상태: Accepted
- 관련 결정: [ADR-001](<../ADR/[ADR-001] Task를 업무 SSOT로 사용.md>)

## 정책

1. Task는 사용자가 관리하는 업무의 유일한 기준점이다.
2. Jira·Slack·GitHub·Calendar·Confluence·AI 세션은 Task의 source 또는 evidence이며 Task 상태를 독자적으로 덮어쓰지 않는다.
3. 외부 연결 없이도 Task를 만들고 완료할 수 있다.
4. 외부 상태와 Task 상태가 다르면 자동 변경 대신 상태 제안을 생성한다.
5. 사용자 상태 변경은 revision 검증을 거치며 stale 변경은 최신 상태를 덮어쓰지 않는다.
6. Task 삭제는 외부 원본을 삭제하지 않고 Orbit의 연결만 해제한다. 미해결 외부 action이 있으면 삭제를 막는다.
7. `done`은 완료 기록을 통해서만 진입하며 재개하면 기존 완료 기록은 감사 가능한 형태로 보존한다.

## 근거

- `src/entities/work-context/model/work-item.ts`
- `src/entities/work-context/api/work-continuity-repository.ts`
- `src-tauri/migrations/0021_work_continuity_foundation.sql`
