# 완료 기록 정책

- 상태: Accepted
- 관련 결정: [ADR-004](<../ADR/[ADR-004] 완료 기록과 근거 스냅샷의 원자적 저장.md>)

## 정책

1. Task 완료는 상태 값만 `done`으로 바꾸는 행위가 아니다.
2. 결과 요약, 주요 결정, 남은 위험, 다음에 다르게 할 점과 연결 evidence를 하나의 completion episode로 저장한다.
3. completion episode 생성, Task 완료, focus 해제는 원자적으로 성공하거나 모두 실패해야 한다.
4. evidence는 완료 시점 스냅샷이며 credential 패턴을 제거하고 개수와 길이를 제한한다.
5. 사용자는 회고를 건너뛸 수 있다. 이 경우 `기록하지 않음`, `확인하지 않음`처럼 생략 사실만 저장하고 성과나 판단을 추론하지 않는다.
6. 완료 Task를 재개해도 과거 completion episode를 삭제하지 않고 superseded 이력으로 보존한다.

## 근거

- `src/entities/work-context/api/completion-repository.ts`
- `src/features/tasks/work-continuity/model/index.ts`
- `src-tauri/migrations/0025_repair_completion_revision_protocol.sql`
