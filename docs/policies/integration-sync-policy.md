# 외부 연동과 동기화 정책

- 상태: Accepted

## 정책

1. 외부 읽기 결과는 source와 scope별 캐시로 저장하고 마지막 성공·시도·실패 상태를 구분한다.
2. TTL 안의 캐시는 fresh, 지난 캐시는 stale로 표시한다. 원격 실패를 빈 성공으로 바꾸지 않는다.
3. 동일 source·scope의 동시 refresh는 하나의 실행으로 합친다. 서로 다른 scope의 결과는 섞지 않는다.
4. Jira·GitHub·Slack·Calendar·Confluence 원본을 Orbit Task와 동일시하지 않는다.
5. 외부 쓰기는 정확한 대상과 변경 내용을 preview한 뒤 사용자 승인을 받아야 한다.
6. 승인 이후 대상 revision이나 remote 상태가 바뀌면 실행하지 않는다.
7. 네트워크 결과가 모호하면 자동 재시도하지 않고 `needs-reconciliation`으로 전환해 원격 상태를 먼저 확인한다.
8. 앱 재기동 시 실행 중이던 durable outbox를 복구한다.

## 근거

- `src/entities/work-context/model/source-capability.ts`
- `src/entities/work-context/api/source-sync-repository.ts`
- `src/features/sources/jira-outbox-safety`
- `src/features/sources/jira-outbox-recovery`
