# Spec: Orbit 개인 업무 연속성

- 상태: Accepted
- Linked PRD: [prd-orbit-work-continuity.md](prd-orbit-work-continuity.md)

## 1) 기능 목록

| 기능 | 계약 |
| --- | --- |
| Task | 로컬 생성, 수정, 상태 전이, 정렬, 날짜·우선순위 관리 |
| Planner | 월간 날짜 선택, 카테고리·루틴·리마인더, Today와 핵심 세 개 |
| Focus | 단일 집중 슬롯, 교체·종료 시 안전한 handoff |
| Context | 외부 객체와 AI 세션의 다중 연결 및 명시적 해제 |
| Completion | 회고 또는 명시적 skip, 근거 snapshot, 검색·재개 |
| Integration | 소스별 freshness, 읽기 캐시, 승인된 외부 쓰기 |
| Graph | canonical data를 수정하지 않는 local projection과 bounded retrieval |

## 2) API/데이터 계약

### WorkItem

- `id`, `title`, `status`, `priority`, `position`, `createdAt`, `updatedAt`를 기본 식별·정렬 계약으로 사용한다.
- 연속성 필드에는 `checkpoint`, `nextAction`, `blockedReason`, `resumeCondition`, `pausedAt`, `revision`이 포함될 수 있다.
- 외부 객체는 WorkItem 행에 복제하지 않고 `work_item_links` 또는 해당 relation 저장소로 연결한다.

### Focus

- focus 획득·교체·해제는 `switchFocusedWorkItem` 단일 경계를 사용한다.
- 호출자는 focus slot과 관련 Task의 예상 revision을 제공한다.
- 충돌 시 저장된 상태를 부분 변경하지 않고 실패한다.

### Completion

- `completeWorkItem`은 네 개의 명시적 완료 필드와 최대 100개의 정제된 evidence를 받는다.
- completion record 생성이 성공해야 Task가 `done`으로 전이된다.
- skip 값은 결과를 추론하지 않고 사용자 생략·미확인을 표시한다.

### Secrets

- Tauri command는 `com.orbit.desktop` Keychain service 아래 provider별 secret ID를 읽고 쓴다.
- TypeScript 저장소는 token 값을 로컬 설정 또는 Graph에 복제하지 않는다.

## 3) 상태/시퀀스

### 집중 교체

```text
진행 중 Task에서 집중 시작
  → 현재 focus 확인
  → 기존 focus가 있으면 checkpoint/nextAction 입력
  → slot revision + 두 Task revision 검증
  → 기존 focus 해제와 새 focus 획득을 원자적으로 적용
```

### 완료

```text
완료 요청
  → 회고 입력 또는 건너뛰기 선택
  → 연결 evidence 정제·snapshot
  → completion record INSERT
  → DB trigger가 Task done + focus 해제를 함께 적용
  → 실패 시 전체 rollback
```

### 외부 쓰기

```text
원격 상태 조회 → 정확한 변경 preview → 사용자 승인
  → revision/hash 검증 → outbox executing → 원격 요청
  → succeeded 또는 needs-reconciliation → 재기동 복구
```

## 4) 테스트 시나리오

- **TS-1:** 외부 연결이 없는 Task 생성과 상태 변경
- **TS-2:** 서로 다른 source link를 동일 Task에 연결·해제
- **TS-3:** focus 획득·교체·해제를 ID 순서와 무관하게 수행
- **TS-4:** 누락된 checkpoint와 stale revision의 전이를 거절
- **TS-5:** completion·evidence·focus 해제를 한 transaction으로 적용하고 late failure rollback
- **TS-6:** skip completion 값이 validation을 통과하고 허위 내용을 포함하지 않음
- **TS-7:** Jira action의 stale approval·ambiguous result·startup reconciliation 검증
- **TS-8:** payload와 indexed text에서 credential 패턴 제거
- **TS-9:** fresh/stale/failed cache provenance 구분
- **TS-10:** Graph generation publish 실패 중 이전 ready generation 유지

## 5) 수용기준 추적(AC 매핑)

| AC ID | Spec Scenario | Verification Type | Evidence Path |
| --- | --- | --- | --- |
| AC-1 | TS-1 | integration | `src/entities/work-context/api/migration-trigger.test.ts` |
| AC-2 | TS-2 | integration | `src/entities/work-context/api/automation-mutation.integration.test.ts` |
| AC-3 | TS-3 | integration | `src/entities/work-context/api/work-continuity-migration.integration.test.ts` |
| AC-4 | TS-4 | unit/integration | `src/entities/work-context/api/work-continuity.test.ts`, `work-continuity-migration.integration.test.ts` |
| AC-5 | TS-5 | integration | `src/entities/work-context/api/work-continuity-migration.integration.test.ts` |
| AC-6 | TS-6 | unit | `src/tests/features/work-continuity/presenters.test.ts` |
| AC-7 | TS-7 | unit/integration | `src/tests/features/source-sync/jira-outbox-safety.test.ts`, `jira-outbox-recovery.test.ts` |
| AC-8 | TS-8 | unit/code inspection | `src-tauri/src/lib.rs`, `src/entities/work-context/api/completion-repository.ts` |
| AC-9 | TS-9 | unit | `src/entities/work-context/api/query-cache-fallback.test.ts` |
| AC-10 | TS-10 | integration | `src/entities/work-context/api/context-graph-repository.test.ts` |
