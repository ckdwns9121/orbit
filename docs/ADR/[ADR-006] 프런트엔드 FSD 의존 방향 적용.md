# [ADR-006] 프런트엔드 FSD 의존 방향 적용

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

빠르게 추가된 페이지와 integration 로직이 하나의 App component와 수평 폴더에 모이면 변경 영향과 소유 경계를 파악하기 어렵다. 도메인별 완전 분리를 한 번에 수행하면 기존 SQLite repository와 기능 흐름에서 대규모 회귀가 발생할 수 있다. 점진적 분리와 자동 검증 가능한 의존 규칙이 필요하다.

## Decision

프런트엔드에 `app → pages → widgets → features → entities → shared` FSD 계층을 적용한다. 외부 계층은 feature public API를 사용하고 하위 계층의 상위 역참조를 금지한다. 기존 데이터 영역은 `entities/work-context` bounded context에서 점진 분리한다.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| FSD 계층 + 자동 검사 | 변경 이유와 의존 방향이 명확하고 점진 이동 가능 | 작은 기능에도 경로 규칙 학습 필요 |
| 기술 종류별 폴더 | 시작이 단순함 | 제품 기능이 여러 폴더에 흩어지고 영향 추적이 어려움 |
| 전면 도메인 재작성 | 이상적인 분리를 한 번에 달성 | 회귀 위험과 검증 범위가 큼 |

**최종 결정:** 기능 동작을 유지하며 FSD로 점진 이동하고 `verify:fsd`로 구조 규칙을 강제한다.

## Reference

- [FSD Architecture](../fsd-architecture.md)
- `scripts/verify-fsd.ts`
