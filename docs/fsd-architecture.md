# Orbit FSD 구조

Orbit 프런트엔드는 사용자 흐름과 변경 이유를 기준으로 다음 계층을 사용한다.

```text
app → pages → widgets → features → entities → shared
```

- `app`: 애플리케이션 초기화, 전역 레이아웃, 내비게이션
- `pages`: 라우팅 가능한 화면 조합
- `widgets`: 여러 feature/entity를 조합하는 독립 UI 블록
- `features`: 사용자가 수행하는 행동과 유스케이스
- `entities`: Orbit의 업무 데이터와 저장소
- `shared`: 제품 도메인을 모르는 공용 UI, 설정, 스타일

상위 계층은 하위 계층을 사용할 수 있지만 하위 계층은 상위 계층을 참조하지 않는다.

## Feature 규칙

Feature는 `src/features/<domain-group>/<feature-name>` 구조를 사용한다.

```text
features/
  tasks/
    task-ai-fix/
      index.ts
      ui/
        index.tsx
        style.scss
```

외부 계층은 feature 내부 파일 대신 feature root의 `index.ts`를 통해 접근한다. 허용 segment는 `api`, `hooks`, `components`, `model`, `lib`, `schema`, `ui`, `utils`다.

## Entity 전환 정책

기존 `domain`과 `data`는 데이터 손실과 순환 의존을 피하기 위해 우선 `entities/work-context/model`과 `entities/work-context/api`라는 하나의 bounded context로 이동했다. 기능 동작을 바꾸지 않는 구조 리팩터링이 안정화된 뒤 WorkItem, Jira, GitHub, AI Session 단위 slice로 점진 분리한다.

## 검증

```bash
bun run verify:fsd
```

검증기는 최상위 FSD 경로, feature segment, feature public API, 계층 역참조를 검사한다.
