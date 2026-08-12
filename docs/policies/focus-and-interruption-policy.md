# 집중과 중단 정책

- 상태: Accepted
- 관련 결정: [ADR-003](<../ADR/[ADR-003] 단일 집중 슬롯.md>)

## 정책

1. 진행 중 Task는 여러 개일 수 있지만 현재 집중 Task는 최대 하나다.
2. 집중 시작은 명시적인 사용자 행동이어야 한다.
3. 집중 중에는 현재 Task에 필요한 도구를 제외한 다른 Task와 주요 내비게이션을 비활성화한다.
4. 다른 Task로 교체하거나 집중을 종료할 때 기존 Task의 `checkpoint`와 `nextAction`을 저장한다.
5. 체크포인트 저장 또는 전이가 실패하면 기존 집중 잠금을 유지한다.
6. 집중 Task 완료는 완료 기록 흐름을 거치며 성공 후에만 잠금을 해제한다.
7. 앱 종료 자체를 차단하지 않으며 다음 실행에서 저장된 집중 상태를 복구한다.

## 근거

- `src/entities/work-context/model/work-continuity.ts`
- `src/entities/work-context/api/work-continuity-repository.ts`
- `src/features/tasks/work-continuity`
- `src-tauri/migrations/0024_repair_continuity_focus_protocol.sql`
