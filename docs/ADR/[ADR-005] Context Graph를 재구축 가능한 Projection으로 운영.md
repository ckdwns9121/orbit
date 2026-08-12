# [ADR-005] Context Graph를 재구축 가능한 Projection으로 운영

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

Task 주변의 Jira, PR, 커밋, Slack, 문서, Calendar와 AI 세션을 관계 기반으로 탐색해야 한다. Graph가 원본 상태까지 소유하면 기존 저장소와 이중 장부가 생기고 인덱싱 실패가 Task 손상으로 이어질 수 있다. 별도 graph server는 개인 데스크탑 앱에 운영 부담을 추가한다.

## Decision

canonical SQLite table로부터 결정론적으로 재구축 가능한 versioned property-graph projection을 SQLite 안에 유지한다. 명시적 relation을 추론 relation보다 우선하며, generation 단위 publish로 reader가 완성된 snapshot만 보게 한다.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| SQLite projection | 로컬 운영, 원본 격리, 재구축과 transaction 활용 | graph-native query 기능이 제한됨 |
| Graph를 canonical store로 사용 | 관계 질의가 직접적임 | 기존 Task/integration 상태와 migration 위험 증가 |
| 외부 Graph DB | 대규모 graph 기능과 확장성 | 설치·운영·개인정보·오프라인 복잡도 증가 |

**최종 결정:** SQLite canonical data를 유지하고 Graph는 교체 가능한 derived index로 제한한다.

## Reference

- [Context Graph Architecture](../context-graph-architecture.md)
- `src-tauri/migrations/0028_context_graph_hardening.sql`
