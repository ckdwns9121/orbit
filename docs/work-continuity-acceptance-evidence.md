# Orbit 업무 연속성 수용 증거

작성 시각: 2026-08-07 (Asia/Seoul)

대상 문서:

- `.omx/plans/prd-orbit-work-continuity.md`
- `.omx/plans/test-spec-orbit-work-continuity.md`

이 문서는 구현 파일, 실행한 자동 테스트, 로컬 런타임 확인 지점을 사용자 스토리별로 연결한다. 실행하지 않은 수동 검증은 통과로 간주하지 않는다.

## 판정 표기

- **자동 PASS**: 아래 명령으로 직접 실행해 성공을 확인했다.
- **구현 연결**: UI 또는 애플리케이션 경로가 코드에 연결된 것을 확인했다. 수동 조작을 실행했다는 뜻은 아니다.
- **런타임 확인**: 기존 사용자 DB로 Tauri를 기동하고 실제 화면 렌더링 또는 재기동 복원을 확인했다.
- **외부 gap**: 로컬·mock 경계로 대체할 수 없는 외부 시스템 검증이다.

## 실행 명령과 결과

| 명령 | 실행 결과 |
|---|---|
| `bun test src/data/work-continuity-performance.test.ts` | **PASS**, 5 tests, 75 assertions |
| `bun test` | **PASS**, 157 tests, 465 assertions |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS**, 31 tests |
| `cargo check --manifest-path src-tauri/Cargo.toml` | **PASS** |
| `bun run build` | **PASS**, TypeScript + Vite production build |

위 결과는 이 문서 작성 시점에 실제 실행한 결과다. 이후 코드 변경이 있으면 전체 명령을 다시 실행해야 한다.

## 표준 성능 fixture

자동 fixture는 migration 0001부터 최신 migration까지 적용한 메모리 SQLite에 다음 데이터를 넣는다.

- Task 1,000개
- `activity_events` 20,000개
- Inbox candidate 5,000개
- 완료 기록과 근거 링크 각 1,000개
- `PRAGMA foreign_keys = ON` 및 `foreign_key_check` 통과

파일: `src/data/work-continuity-performance.test.ts`

전체 테스트 실행 중 측정값:

| 측정 | 반복 | 결과 | 목표 |
|---|---:|---:|---:|
| Dashboard SQL + row mapping + 오늘/어제 bucket + 연속성 브리핑 준비 | warm-up 3회 후 7회 | 중앙값 **4.20ms** | <200ms |
| 완료 기록 텍스트/기간/Jira project/source/state 필터 | warm-up 3회 후 7회 | 중앙값 **0.54ms** | <200ms |
| no-focus 재개: Dashboard 준비 → focus CAS command → checkpoint/next action/evidence 조회 | 3회 | **5.42 / 5.46 / 8.39ms** | 각 <200ms |

측정은 warm local in-memory SQLite의 애플리케이션 데이터 경로다. 사용자가 버튼을 누르고 drawer를 인식하는 30초 수동 측정으로 바꾸어 주장하지 않는다. 수동 측정은 실제 Tauri UI와 표준 fixture를 연결한 최종 런타임 단계에서 별도로 기록해야 한다.

쿼리 계획 검증:

- 작업별 활동 시간 조회: `activity_events_work_item_time`
- 완료 기록 시간 조회: `completion_records_history`
- source/scope 조회: `sqlite_autoindex_source_sync_state_1`

## 사용자 스토리 증거 매트릭스

| Story | 구현 파일 | 자동 증거 | 런타임/수동 증거 | 현재 판정 |
|---|---|---|---|---|
| US-F0-1 중앙 Task 전이 | `src/domain/work-continuity.ts`, `src/data/work-continuity-repository.ts`, `src-tauri/migrations/0021_*`, `0024_*`, `0025_*`, `src/App.tsx`, `src/tray/TrayApp.tsx` | `migration-trigger.test.ts`의 atomic transition/focus/suggestion; `work-continuity-migration.integration.test.ts`의 CAS·rollback·양방향 ID 순서; `work-continuity.test.ts` | App의 `commitMove`/`handleResume`와 Tray의 `switchFocusedWorkItem` 연결 확인. App/Tray 동일 동작 수동 조작은 최종 단계 필요 | 자동 PASS · 구현 연결 |
| US-F0-2 migration regression | `src-tauri/migrations/0021_*`–`0026_*`, `src-tauri/src/lib.rs` | `work-continuity-migration.integration.test.ts`: 빈 DB, 대표 0020 DB, interim completion repair, FK·data preservation; `migration-trigger.test.ts` | 기존 사용자 DB를 백업한 뒤 Tauri를 재기동해 migration 26 성공, FK 무결성, 최신 자동화 트리거를 확인 | 자동 PASS · 런타임 PASS |
| US-P0-1 구조화된 중단 | `src/continuity/ContinuityDialogs.tsx`, `src/App.tsx`, `src/tray/TrayApp.tsx`, `src/domain/work-continuity.ts`, `src/data/work-continuity-repository.ts` | `work-continuity.test.ts`: blocked/focus handoff; `presenters.test.ts`: validation; migration guard·rollback tests | App/Tray가 같은 중앙 전이 경계와 dialog 계약을 사용함을 확인 | 자동 PASS · 구현 연결 |
| US-P0-2 근거 기반 checkpoint 초안 | `src/App.tsx`의 interruption evidence/draft effect, `src/continuity/ContinuityDialogs.tsx`, `src/domain/ai-session.ts`, `src/domain/work-continuity.ts` | `ai-session.test.ts`: injected context 제거; `work-continuity.test.ts`: credential/body payload 제거 | AI/Jira/GitHub 근거 조합, 편집 가능한 draft와 deterministic fallback 경로 확인 | 자동 PASS · 구현 연결 |
| US-P0-3 재개 briefing/원클릭 | `src/dashboard/DashboardPage.tsx`, `src/continuity/presenters.ts`, `src/App.tsx#handleResume`, Task context drawer 경로 | `presenters.test.ts`: Continue/blocked/forgotten ordering·future review 억제; `work-continuity-performance.test.ts`: 1k/20k Dashboard와 재개 3회 | Dashboard 최상단 viewport와 재개→focus→drawer 연결 확인, 데이터 경로 3회 모두 13ms 미만 | 자동 성능 PASS · 런타임 확인 |
| US-P0-4 상태 제안 | `src/domain/task-flow.ts`, `src/data/work-continuity-repository.ts`, `src/App.tsx#handleApplySuggestion`, `status_suggestions` migration | `task-flow.test.ts`: 완료 대신 review 제안; `migration-trigger.test.ts`: revision-bound apply/stale | 제안 적용/무시 및 Jira Done이 completion flow를 여는지 수동 확인 필요 | 자동 PASS · 구현 연결 |
| US-P0-5 source freshness | `src/sources/source-capability.ts`, `src/data/source-sync-repository.ts`, `src/sources/connected-source-refresh.ts`, `src/continuity/ContinuityPage.tsx`, `src/App.tsx` | `source-capability.test.ts`, `foundation-pure.test.ts`, `query-cache-fallback.test.ts`: TTL, scope single-flight, cooldown, stale cache provenance | sidebar/diagnostics의 age/count/error와 scoped refresh 경로 확인 | 자동 PASS · 구현 연결 |
| US-P0-6 continuity metrics | `src/domain/work-continuity.ts`, `src/data/continuity-metrics-repository.ts`, `src/data/work-continuity-repository.ts`, Diagnostics view | migration event tests; `work-continuity.test.ts`의 payload scrub; 표준 20k event fixture | 진단 화면의 기간·event count·세 지표 렌더링 경로 확인 | 자동 PASS · 구현 연결 |
| US-P1-1 통합 Inbox | `src/data/inbox-repository.ts`, `src/continuity/ContinuityPage.tsx#InboxView`, `src-tauri/migrations/0022_*` | `migration-trigger.test.ts`: Inbox audit event; integration test의 삭제 시 linked→new 복원/FK; `repository-pagination.test.ts`: 520개 중 offset 500 접근 | 기존 DB의 Jira Inbox 187개와 action UI 렌더링 확인 | 자동 PASS · 런타임 확인 |
| US-P1-2 Slack→Task 승인 | `src/sources/slack-task-conversion.ts`, `src/data/inbox-repository.ts`, Slack 검색/Inbox UI 경로 | `slack-task-conversion.test.ts`: preview, 승인만 생성, permalink idempotency, tamper/version reject, Slack write 0회 | Slack 검색 결과→Inbox 저장→preview UI 연결 확인 | 자동 PASS · 구현 연결 |
| US-P1-3 Jira 양방향 승인 | `src/sources/jira-transition-adapter.ts`, `src/sources/jira-outbox-safety.ts`, `src-tauri/src/jira_transition.rs`, `src/continuity/ContinuityPage.tsx#JiraWritebackView` | `jira-transition-adapter.test.ts`, `jira-outbox-safety.test.ts`, Rust Jira transition tests: exact hash/transition, stale approval, error, already-Done, reconciliation | mock/local path은 자동 검증. 실제 Jira staging 계정 POST만 외부 gap | 자동 PASS · **외부 gap 1건** |
| US-P1-4 완료 시트/evidence | `src/continuity/ContinuityDialogs.tsx#CompletionSheet`, `src/data/completion-repository.ts`, `src/App.tsx`, `src-tauri/migrations/0025_*` | completion validation; migration completion/focus atomicity; completion migration repair; history 성능 test | 편집 가능한 완료 sheet, snapshot, 재열기, Jira 실패 격리 경로 확인 | 자동 PASS · 구현 연결 |
| US-P1-5 durable outbox | `src/data/external-action-repository.ts`, `src/sources/jira-outbox-safety.ts`, `src/sources/jira-outbox-recovery.ts`, `src/App.tsx` startup recovery | `jira-outbox-safety.test.ts`, `jira-outbox-recovery.test.ts`, migration deletion/reconciliation guards, Rust reconciliation tests | 기존 DB 앱 재기동과 startup recovery/retry UI 연결 확인 | 자동 PASS · 런타임 확인 |
| US-P2-1 완료 결정/실패 검색 | `src/data/completion-repository.ts`, `src/continuity/ContinuityPage.tsx#HistoryView`, `src/data/chat-ai-repository.ts` | `chat-completion-grounding.test.ts`: grounded result/no-result/failure; `presenters.test.ts`; history 1,000-record 성능·source filter; `repository-pagination.test.ts`: 필터 유지 offset 200 접근 | 필터와 페이지 UI 구현 연결 확인 | 자동 PASS · 구현 연결 |
| US-P2-2 주간 회고 | `src/data/weekly-review-repository.ts`, `src/continuity/ContinuityPage.tsx#WeeklyReviewView`, `weekly_reviews` migration | `foundation-pure.test.ts`: Monday range; migration/FK suite | versioned regenerate, partial warning, deterministic section UI 연결 확인 | 자동 PASS · 구현 연결 |
| US-P2-3 checklist/template | `src/data/task-template-repository.ts`, `src/continuity/ContinuityPage.tsx#TemplateView`, template/checklist migrations | `foundation-pure.test.ts`: token normalization; migration/FK suite | 저장·추천 이유·adopt/reject/anti-spam 경로 확인 | 자동 PASS · 구현 연결 |
| US-P2-4 opt-in local automation | `src/domain/automation.ts`, `src/data/automation-repository.ts`, `src/continuity/ContinuityPage.tsx#AutomationView`, automation migrations | `foundation-pure.test.ts`: forbidden action; `automation.test.ts`: undo/draft/read-only refresh 검증; `automation-mutation.integration.test.ts`: exact ignore/link undo, draft discard, malformed/stale undo와 변경된 child link/AI session 보호; migration/FK suite | 기본 비활성 UI와 production runner 연결 확인 | 자동 PASS · 구현 연결 |

## 외부 검증 gap

외부 시스템이 필요한 검증 gap은 한 가지다.

1. 유효한 Jira staging 계정에서 preview된 정확한 Done transition을 사용자가 승인한 뒤 실제 POST하고, Jira와 Orbit outbox가 `succeeded`로 수렴하는지 확인.

Slack 외부 쓰기는 제품 범위에 없고, Calendar/Slack/Confluence/GitHub는 읽기 경계다. Jira write-back의 request binding, stale approval, already-Done, 오류 분류, restart reconciliation은 mock/단위/Rust 테스트로 실행했다.

## 로컬 런타임·시각 증거

- 기존 사용자 DB를 백업한 뒤 Tauri 재기동, migration 26 checksum/트리거, `PRAGMA foreign_key_check`, 업무 흐름 Inbox 187개 렌더링을 확인했다.
- Dashboard와 업무 흐름 최상단 viewport를 실제 앱에서 확인했고 visual-verdict는 **94/100 PASS**다.
- 대용량 페이지 이동, 상태 전이, Inbox action, completion, Jira outbox, automation/undo는 실제 SQLite를 사용하는 service·migration 통합 테스트로 검증했다. 사용자 데이터에 테스트 mutation을 만들기 위한 수동 클릭은 수행하지 않았다.
- 캡처는 로컬 `/tmp/orbit-final-continuity.png`, DB 복구 전 백업은 `orbit-before-automation-repair-20260807.db`이다.
- 이후 코드가 변경되면 전체 `bun test`, build, cargo test/check와 migration/FK 검사를 다시 실행해야 한다.
