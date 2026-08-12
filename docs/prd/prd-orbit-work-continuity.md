# PRD: Orbit 개인 업무 연속성

- 상태: Accepted
- Mode: reverse
- Scope: `src/app`, `src/pages`, `src/features`, `src/entities/work-context`, `src/widgets`, `src-tauri`
- Evidence Base: `docs/product-problem.md`, `src/entities/work-context/model/work-item.ts`, `src/entities/work-context/api/work-continuity-repository.ts`, `src/entities/work-context/api/completion-repository.ts`, `src-tauri/migrations/0021_work_continuity_foundation.sql`

## 1) 배경/문제

AI 세션과 Jira, GitHub, Slack, Calendar를 오가면 실행 가능한 작업 수는 늘지만 사용자가 기억해야 하는 진행 상태도 늘어난다. 작업을 전환한 뒤 이전 작업의 현재 지점과 다음 행동을 잃고, 완료된 업무의 결과와 근거도 흩어진다. 개별 도구의 목록을 더 만드는 것만으로는 이 문제를 해결할 수 없다.

## 2) 목표

- 모든 업무를 로컬 Task라는 하나의 관리 단위로 표현한다.
- 오늘 해야 할 일과 현재 집중할 일을 빠르게 선택하게 한다.
- 중단 시 진행 지점과 다음 행동을 보존해 다시 시작하는 비용을 낮춘다.
- Jira·GitHub·Slack·Calendar·AI 세션을 Task의 근거로 연결한다.
- 완료 시 결과와 연결 근거를 검색 가능한 기록으로 보존한다.
- 외부 서비스 장애 중에도 로컬 업무 관리를 지속한다.

## 3) 비목표

- Jira, GitHub, Slack 자체를 대체하는 팀 협업 시스템
- 조직 단위 리소스·로드맵·스프린트 관리
- 외부 정보를 근거 없이 자동 변경하는 완전 자율 에이전트
- 클라우드 다중 사용자 동기화
- Context Graph를 Task의 원본 저장소로 사용하는 것

## 4) 범위

### 포함

- Task 생성·수정·정렬·상태 전이·삭제
- 월간 Planner, Today 계획과 오늘의 핵심 작업 세 개
- 단일 집중, 중단 체크포인트와 재개
- Jira·GitHub·Slack·Google Calendar·Confluence·AI 세션 읽기 및 연결
- 승인된 Jira write-back과 복구 가능한 외부 action
- 완료 기록, 연결 근거 스냅샷, 완료 검색
- 로컬 기반 AI Chat과 Context Graph grounding

### 제외

- 팀원에게 Task 할당
- 외부 서비스의 범용 편집 UI
- 자동 Slack 메시지 전송
- 모바일·웹 동기화

## 5) 아키텍처 제약

- SQLite의 `work_items`가 Task 원본이며 외부 연결은 별도 relation으로 보관한다.
- 비밀정보는 macOS Keychain에만 저장한다.
- 상태 전이는 revision 기반 충돌 검증을 통과해야 한다.
- 집중 Task는 데이터베이스 단일 슬롯으로 제한한다.
- 외부 쓰기는 preview·승인·outbox·reconciliation 경계를 거친다.
- Context Graph는 canonical table로부터 재구축 가능한 projection이다.
- 프런트엔드는 `app → pages → widgets → features → entities → shared` 의존 방향을 지킨다.

## 6) 사용자 시나리오

1. 사용자는 월간 달력에서 날짜를 선택하고 업무·할 일·공부 카테고리의 Task를 추가한다.
2. 사용자는 Jira 티켓이나 Slack 요청을 확인해 기존 Task에 연결하거나 새 Task로 전환한다.
3. 사용자는 진행 중 Task에서 집중을 시작한다. 다른 작업은 시각적·상호작용적으로 잠긴다.
4. 긴급 작업으로 전환할 때 현재까지 한 일과 돌아왔을 때 첫 행동을 기록한다.
5. 사용자는 Dashboard 또는 Task 상세에서 체크포인트와 연결 근거를 확인하고 작업을 재개한다.
6. 완료 시 회고를 기록하거나 명시적으로 건너뛰고, 당시의 연결 근거와 함께 완료한다.

## 7) 수용기준(AC)

- **AC-1:** 외부 연결이 없어도 Task를 생성하고 상태·우선순위·날짜를 관리할 수 있다.
- **AC-2:** Jira·PR·커밋·Slack·AI 세션을 하나의 Task에 다중 연결할 수 있다.
- **AC-3:** 동시에 focus 상태인 Task는 최대 하나이며 충돌한 요청은 기존 집중 상태를 손상시키지 않는다.
- **AC-4:** 집중 Task를 중단·교체할 때 체크포인트와 다음 행동 없이는 전이가 완료되지 않는다.
- **AC-5:** Task 완료와 활성 완료 기록·연결 근거 스냅샷은 하나의 원자적 전이로 처리된다.
- **AC-6:** 회고 건너뛰기는 허위 결과를 생성하지 않고 건너뛴 사실을 식별 가능하게 저장한다.
- **AC-7:** 외부 쓰기는 사용자의 승인과 정확한 대상·revision 검증 없이 실행되지 않는다.
- **AC-8:** 인증정보는 SQLite·로그·Graph index에 평문으로 저장되지 않는다.
- **AC-9:** 외부 조회 실패 시 마지막 캐시의 신선도와 실패 상태를 구분해 표시한다.
- **AC-10:** Context Graph를 삭제·재구축해도 Task와 명시적 외부 연결은 보존된다.

## 8) 리스크

- 개인용 기능이 계속 추가되면 Today 핵심 흐름이 복잡해질 수 있다.
- 외부 API 정책과 OAuth 검증 상태에 따라 연결 경험이 달라질 수 있다.
- 로컬 DB 스키마 변경 오류는 기존 사용자 앱 실행을 막을 수 있다.
- 추론 연결의 오탐이 사용자의 컨텍스트 신뢰를 떨어뜨릴 수 있다.
- ad-hoc 서명 빌드는 Keychain 접근 승인을 반복해서 요구할 수 있다.

## 9) 롤아웃

1. 로컬 Task·Planner·집중·완료 루프를 기본 경로로 유지한다.
2. 외부 읽기 연동은 설정한 소스만 점진 활성화한다.
3. 외부 쓰기는 Jira의 명시적 승인 경로부터 제한적으로 제공한다.
4. migration·FSD·TypeScript·Bun·Rust 검증을 CI에서 통과한 빌드만 배포한다.
5. OAuth와 Apple 서명은 개인 개발 설정과 배포용 안정 설정을 분리한다.

## Evidence Notes

- 문제와 제품 판단 기준: `docs/product-problem.md`, `docs/product-solution.md`
- Task와 상태 모델: `src/entities/work-context/model/work-item.ts`, `src/entities/work-context/model/work-continuity.ts`
- 집중 전이: `src/entities/work-context/api/work-continuity-repository.ts`, `src-tauri/migrations/0021_work_continuity_foundation.sql`
- 완료 원자성: `src/entities/work-context/api/completion-repository.ts`, `src-tauri/migrations/0025_repair_completion_revision_protocol.sql`
- 외부 쓰기 안전성: `src/features/sources/jira-outbox-safety`, `src/features/sources/jira-outbox-recovery`
- Context Graph: `docs/context-graph-architecture.md`, `src-tauri/migrations/0028_context_graph_hardening.sql`
- 프런트엔드 구조: `docs/fsd-architecture.md`, `scripts/verify-fsd.ts`
