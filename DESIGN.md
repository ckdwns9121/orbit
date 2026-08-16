# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-15
- Primary product surfaces: Planner, Task, Calendar, Workspace, Jira Tickets, Chat, Graph, Settings, menu bar Quick View
- Evidence reviewed:
  - `README.md`
  - `docs/product-problem.md`
  - `docs/product/product-principles.md`
  - `docs/prd/prd-orbit-work-continuity.md`
  - `docs/context-graph-architecture.md`
  - `docs/fsd-architecture.md`
  - `src/app/App.scss`
  - `src/app/ui/AppSidebar.tsx`
  - `src/app/ui/AppTabBar.tsx`
  - `src/shared/styles/_tokens.scss`
  - Orca의 `src/main/window/createMainWindow.ts`, `src/renderer/src/components/tab-bar`, `src/renderer/src/assets/main.css`를 커스텀 타이틀바와 탭 상호작용의 시각 참고 자료로 사용

이 문서는 Orbit UI의 제품·상호작용·시각 기준이다. Orca는 밀도, 패널 구성, 중립적 색상과 데스크톱 도구의 정밀함을 참고하는 시각 레퍼런스다. Orbit의 정보 구조와 업무 연속성 원칙은 Orbit 문서와 도메인 모델이 소유한다.

## Brand

- Personality: 차분하고 정밀하며, 사용자의 기억을 대신하는 신뢰 가능한 업무 도구
- Trust signals: 데이터 출처, 마지막 동기화 시각, 자동화 이유, 승인 대상과 실패 상태를 명확히 표시
- Avoid: 과도한 카드 장식, 장난스러운 생산성 점수, 근거 없는 AI 확신, 모든 요소를 강조색으로 칠하는 화면

## Product goals

- Goals:
  - 사용자가 앱을 열고 지금 할 일과 재개할 지점을 즉시 이해한다.
  - Task 주변의 Jira, GitHub, Slack, Calendar와 AI 세션을 한 흐름에서 탐색한다.
  - 중단·전환·완료 동작이 맥락을 보존하고 결과를 남긴다.
  - 고밀도 화면에서도 상태, 출처와 다음 행동의 우선순위가 분명하다.
- Non-goals:
  - Jira, Slack, GitHub를 그대로 복제하는 범용 클라이언트
  - Orca의 코드 에디터·터미널 중심 정보 구조를 Orbit에 복제하는 것
  - 장식적 대시보드나 성과 점수로 사용자를 압박하는 것
- Success signals:
  - 첫 화면에서 10초 안에 다음 행동을 선택할 수 있다.
  - 화면 간 동일 상태와 동작이 같은 컴포넌트 언어로 보인다.
  - stale·failed·approval-required 상태를 사용자가 오해하지 않는다.

## Personas and jobs

- Primary personas: 여러 AI 세션과 협업 도구를 동시에 사용하는 개인 지식 노동자·개발자
- User jobs:
  - 오늘 해야 할 일을 계획하고 하나에 집중한다.
  - 긴급 작업이 들어와도 기존 작업의 진행 지점과 다음 행동을 보존한다.
  - 흩어진 업무 근거를 찾아 Task에 연결한다.
  - 완료한 업무의 결과와 근거를 회고·성과 자료로 다시 사용한다.
- Key contexts of use: 하루 시작 브리핑, 작업 중 전환, 온콜·긴급 요청 유입, 리뷰 대기, 하루 종료 회고

## Information architecture

- Primary navigation: 좌측 sidebar의 Planner, Task, Calendar, Workspace, Tickets, Chat; 보조 영역으로 Graph와 Settings
- Open-context navigation: sidebar에서 연 화면은 상단 app tab strip에 남는다. 탭은 화면 전환 기록이자 빠른 복귀 수단이며, macOS의 native window tab과 구분되는 Orbit 내부 상태다.
- Core routes/screens:
  - Planner: 오늘·어제 작업, 일정, PR과 재개 브리핑
  - Task: 할 일·진행 중·완료와 집중 상태
  - Calendar: 일정과 계획된 Task
  - Workspace: AI 작업 세션
  - Tickets: Jira와 개발 근거
  - Chat: 연결된 컨텍스트 기반 질의와 승인 가능한 AI 실행
  - Graph: Task와 근거의 관계 탐색
  - Settings: 연동·인증·테마·알림
- Content hierarchy: 다음 행동 → 현재 상태 → 근거와 신선도 → 보조 메타데이터

## Design principles

1. **Action before decoration.** 첫 화면과 각 패널의 상단에는 사용자가 지금 실행할 행동을 둔다.
2. **Dense, not cramped.** Orca처럼 정보 밀도를 높이되 12px 본문과 32px 클릭 영역을 기본 하한으로 삼는다.
3. **Panels express context.** 목록은 중앙 작업 영역에, 선택된 상세·근거·승인은 우측 패널에 배치한다.
4. **State is visible.** 로딩, stale, 실패, 승인 대기와 자동 연결 이유를 숨기지 않는다.
5. **One interaction language.** 동일한 상태·버튼·행·패널은 화면마다 새로 디자인하지 않는다.
6. **Tabs preserve working context.** 상단 탭은 최근에 연 업무 화면을 유지한다. 현재 탭, 닫기, 새 탭 동작을 Orca와 같은 위치·밀도로 제공하되 Orbit의 화면 단위로 동작한다.
- Tradeoffs: 한 화면의 정보량을 늘리는 대신 강한 카드 구분과 큰 타이포를 줄이고, 계층을 여백·경계선·정렬로 표현한다.

## Visual language

- Color: 중립적인 회색 canvas/surface/sidebar를 기본으로 하고 보라색은 선택·AI·주요 행동에만 사용한다. 성공·경고·오류는 의미색으로 분리한다.
- Typography: Inter와 macOS system sans를 사용한다. 화면 제목 18–20px, 섹션 제목 13–14px, 본문 12–13px, 보조 정보 10–11px를 기본으로 한다.
- Spacing/layout rhythm: 4px 기준 단위, 일반 간격 8/12/16/24px. 데스크톱 기본은 36px app titlebar/tab strip + 좌측 sidebar + 중앙 workspace + 선택적 우측 inspector 구조다.
- Shape/radius/elevation: 기본 radius 4–6px, overlay 8px 이하. 경계선으로 계층을 만들고 그림자는 floating surface에만 제한한다.
- Motion: 120–200ms의 짧은 상태 전환. 레이아웃 이동은 의미가 있을 때만 사용하고 `prefers-reduced-motion`을 존중한다.
- Imagery/iconography: Lucide의 1.5–1.75px stroke를 사용한다. 아이콘 단독 버튼에는 accessible name과 tooltip을 제공한다.

## Components

- Existing components to reuse: `AppSidebar`, `AppHeader`, `SearchCombobox`, `ServiceIcon`, Task board와 우측 drawer 패턴
- New/changed components:
  - `AppTabBar`: native title 영역을 대체하는 36px window drag surface, 열린 화면 탭, 닫기, 새 탭 메뉴
  - `AppShell`, `InspectorPanel`, `PanelHeader`, `Toolbar`, `DataTable`, `StatusBadge`
  - `SyncState`, `EmptyState`, `ErrorState`, `Skeleton`, `ApprovalCard`
  - `Button`, `IconButton`, `Input`, `Select`, `Tabs`의 공통 variant
- Variants and states: default, hover, active, focus-visible, selected, disabled, loading, stale, failed, approval-required
- Token/component ownership:
  - semantic CSS variable: `src/shared/styles`
  - 도메인을 모르는 primitive: `src/shared/ui`
  - 사용자 행동을 포함한 조합: 해당 `features` public API
  - 화면 조합: `pages`

## Accessibility

- Target standard: WCAG 2.2 AA를 목표로 한다.
- Keyboard/focus behavior: 모든 주요 흐름은 키보드로 접근 가능하며 `:focus-visible`을 제거하지 않는다. 패널·dialog가 열리면 초점 이동과 복귀를 보장한다.
- Tab behavior: 탭 목록은 `role=tablist`, 각 탭은 `role=tab`과 선택 상태를 제공한다. 탭의 본문 또는 상단 빈 영역을 끌면 앱 창 자체가 이동하고, 짧게 누르면 탭이 활성화된다. 탭 닫기와 새 탭 메뉴는 window drag region에서 제외하고 각각 accessible name을 제공한다.
- Contrast/readability: 본문과 상태 텍스트는 AA 대비를 유지하고 색상만으로 상태를 구분하지 않는다.
- Screen-reader semantics: icon-only action, badge, 진행 상태와 비동기 오류에 적절한 label·role·live region을 제공한다.
- Reduced motion and sensory considerations: reduced-motion에서 물리 애니메이션과 반복 pulse를 제거한다.

## Responsive behavior

- Supported breakpoints/devices: macOS desktop, 최소 폭 800px. 1280px 이상을 기본 작업 폭으로 최적화한다.
- Layout adaptations:
  - 좁은 폭에서는 sidebar를 icon rail로 접는다.
  - 우측 inspector는 overlay drawer로 전환한다.
  - 표는 중요 열을 유지하고 보조 메타데이터를 행 상세로 접는다.
- Touch/hover differences: 현재는 pointer·keyboard 중심이며 hover에만 핵심 정보를 두지 않는다.

## Interaction states

- Loading: 화면 전체 spinner 대신 레이아웃을 유지하는 skeleton과 source별 진행 상태를 사용한다.
- Empty: 비어 있는 이유와 첫 행동을 함께 보여준다.
- Error: 사용자 데이터는 유지하고 실패한 source, 마지막 성공 시각과 재시도 행동을 표시한다.
- Success: 짧고 비차단적인 확인을 사용하며 저장된 결과를 화면에서 즉시 확인할 수 있게 한다.
- Disabled: 비활성 이유를 인접 설명이나 tooltip으로 제공한다.
- Offline/slow network: 로컬 데이터와 캐시를 계속 보여주되 stale 표시를 명확히 한다.

## Content voice

- Tone: 짧고 직접적이며 판단 근거를 숨기지 않는 한국어
- Terminology: `Task`, `집중`, `체크포인트`, `다음 행동`, `연결`, `근거`, `동기화`, `승인`을 일관되게 사용한다.
- Microcopy rules:
  - “완료”와 “저장”처럼 결과가 다른 동사를 섞지 않는다.
  - AI가 실행하지 않은 일을 완료형으로 표현하지 않는다.
  - 오류에는 대상, 영향과 다음 행동을 포함한다.

## Implementation constraints

- Framework/styling system: Tauri 2, React 19, TypeScript, Sass/SCSS, Lucide React
- Design-token constraints: 기존 Sass 상수는 semantic CSS variable로 점진 전환한다. 새 화면에서 raw hex와 임의 radius를 추가하지 않는다.
- Performance constraints: 긴 목록은 virtualization을 유지하고, panel 전환이 전체 페이지 재렌더를 유발하지 않게 한다.
- Compatibility constraints: 현재 macOS 전용이며 light, dark, system theme를 지원한다.
- Window chrome constraints: main window만 macOS overlay titlebar를 사용해 native title text를 숨긴다. native traffic lights는 유지하고 앱이 그린 가짜 traffic light는 사용하지 않는다. tray window 설정은 변경하지 않는다.
- Test/screenshot expectations:
  - 공통 컴포넌트의 상태별 테스트를 추가한다.
  - 주요 화면은 1280×800 light/dark 기준으로 시각 검증한다.
  - `bun run verify:fsd`, `bun run build`, `bun test`를 통과한다.

## Open questions

- [ ] Graph를 1차 navigation에 유지할지 contextual inspector로 이동할지 / Product / 정보 구조 영향
- [ ] 메뉴바 Quick View도 desktop shell과 동일한 token을 공유할지 / Design + Engineering / 구현 범위
- [ ] 800–1024px에서 Chat source rail을 접는 방식 / Design / 반응형 행동
- [ ] 실제 사용자 흐름 기반의 접근성 수동 검증 범위 / QA / 릴리스 기준
