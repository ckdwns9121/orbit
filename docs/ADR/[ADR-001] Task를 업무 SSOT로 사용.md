# [ADR-001] Task를 업무 SSOT로 사용

- 상태: Accepted

| 항목 | 내용 |
| --- | --- |
| 참여자 | TBD |
| 결정자 | TBD |
| 참고자 | TBD |
| 논의일자 | TBD |
| 적용일자 | TBD |
| 만료일자 | - |
| 대체문서 | - |

## Background

업무 신호는 Jira, Slack, GitHub, Calendar와 AI 세션에서 발생하지만 어느 하나도 개인 업무의 목적, 우선순위, 중단 지점과 다음 행동을 모두 표현하지 못한다. 외부 객체를 직접 업무 단위로 사용하면 여러 객체가 하나의 업무를 설명하는 경우 중복 상태가 생기고, 외부 연결 실패가 개인 할 일 관리까지 중단시킨다.

## Decision

Orbit의 `Task(WorkItem)`를 개인 업무 상태의 유일한 기준점으로 사용한다. 외부 객체와 AI 세션은 Task에 다중 연결되는 source 또는 evidence이며, Task의 상태를 독자적으로 소유하지 않는다.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| Task를 SSOT로 사용 | 외부 장애와 무관하게 업무를 관리하고 여러 근거를 하나로 연결할 수 있음 | 외부 상태와의 동기화 정책이 필요함 |
| Jira 티켓을 SSOT로 사용 | 조직 업무 흐름과 즉시 일치함 | Jira가 없는 개인 작업과 여러 source를 표현하기 어려움 |
| source별 상태를 병렬 유지 | 각 서비스의 원형을 보존함 | 충돌 해결과 우선순위 판단이 사용자 기억에 남음 |

**최종 결정:** Task를 SSOT로 사용하고 외부 객체는 명시적 relation으로 연결한다.

## Reference

- [Task 생명주기 정책](../policies/task-lifecycle-policy.md)
- `src/entities/work-context/model/work-item.ts`
