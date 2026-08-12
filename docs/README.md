# Orbit 문서 지도

이 디렉터리는 Orbit의 제품 요구사항, 설계 제안, 확정된 결정, 상시 정책과 검증 증거를 관리한다. 코드가 현재 동작을 설명한다면 문서는 **왜 그렇게 동작해야 하는지**를 설명한다.

## 문서 유형

| 유형 | 질문 | 생성 시점 | 변경 방식 |
| --- | --- | --- | --- |
| PRD | 무엇을 왜 만드는가? | 제품 범위와 수용기준을 정할 때 | 제품 요구가 바뀌는 PR에서 갱신 |
| RFC | 어떤 방향을 선택할 것인가? | 복수 대안의 합의가 필요할 때 | 리뷰 중 수정, 승인 후 고정 |
| Design Document | 선택한 방향을 어떻게 구현·운영할 것인가? | RFC 방향이 정해진 뒤 | 구현과 운영 계약 변경 시 갱신 |
| ADR | 무엇을 결정했고 왜 다른 대안을 버렸는가? | 결정이 확정된 뒤 | 원문 수정 대신 새 ADR로 대체 |
| Policy | 구현과 무관하게 항상 지킬 규칙은 무엇인가? | 제품·데이터 불변 규칙이 생길 때 | 정책 변경 PR에서 ADR과 함께 갱신 |
| Evidence | 수용기준이 실제로 충족되었는가? | 검증 완료 시 | 검증을 다시 실행한 시점에 갱신 |

## 상태

- `Draft`: 검토 중이며 구현의 기준이 아니다.
- `Accepted`: 현재 제품과 구현의 기준이다.
- `Superseded`: 더 새 문서로 대체되었으며 역사적 근거로만 남긴다.
- `Deprecated`: 더 이상 적용하지 않지만 대체 문서가 없을 수 있다.

## 현재 기준 문서

### 제품

- [Orbit 업무 연속성 PRD](prd/prd-orbit-work-continuity.md)
- [Orbit 업무 연속성 Spec](prd/spec-orbit-work-continuity.md)
- [제품 원칙](product/product-principles.md)
- [기존 문제 정의](product-problem.md)
- [기존 솔루션 제안](product-solution.md)

### 정책

- [Task 생명주기](policies/task-lifecycle-policy.md)
- [집중과 중단](policies/focus-and-interruption-policy.md)
- [완료 기록](policies/completion-policy.md)
- [외부 연동과 동기화](policies/integration-sync-policy.md)
- [AI 자동화](policies/ai-automation-policy.md)
- [인증정보와 보안](policies/credential-security-policy.md)
- [데이터베이스 마이그레이션](policies/database-migration-policy.md)

### Architecture Decision Records

- [ADR-001 Task를 업무 SSOT로 사용](<ADR/[ADR-001] Task를 업무 SSOT로 사용.md>)
- [ADR-002 로컬 우선 SQLite 저장](<ADR/[ADR-002] 로컬 우선 SQLite 저장.md>)
- [ADR-003 단일 집중 슬롯](<ADR/[ADR-003] 단일 집중 슬롯.md>)
- [ADR-004 완료 기록과 근거 스냅샷의 원자적 저장](<ADR/[ADR-004] 완료 기록과 근거 스냅샷의 원자적 저장.md>)
- [ADR-005 Context Graph를 재구축 가능한 Projection으로 운영](<ADR/[ADR-005] Context Graph를 재구축 가능한 Projection으로 운영.md>)
- [ADR-006 프런트엔드 FSD 의존 방향 적용](<ADR/[ADR-006] 프런트엔드 FSD 의존 방향 적용.md>)

### 상세 설계와 검증

- [Context Graph Architecture](context-graph-architecture.md)
- [FSD Architecture](fsd-architecture.md)
- [업무 연속성 수용 증거](work-continuity-acceptance-evidence.md)

## 변경 절차

```text
제품 문제·수용기준 변경       → PRD + Spec
합의가 필요한 새 기술 방향    → RFC → Design Document → ADR
이미 확정된 결정의 변경       → 새 ADR(기존 ADR 대체) + 관련 Policy
작은 구현·UI 변경             → PR 설명과 테스트, 필요 시 Spec 갱신
DB·보안·외부 쓰기 경계 변경   → 반드시 ADR + Policy 검토
```

RFC는 `docs/rfc/[RFC-###] 제목.md`, Design Document는 `docs/design-docs/[DD-###] 제목.md`에 둔다. 합의할 제안이 없는 상태에서 빈 문서를 미리 만들지 않는다.

## 문서 작성 규칙

1. 확인할 수 없는 사실은 추측하지 않고 `TBD` 또는 `확인 필요`로 표시한다.
2. 요구사항과 주요 결정에는 코드·테스트·선행 문서 중 하나 이상의 근거 경로를 연결한다.
3. ADR은 수정해 결정을 덮어쓰지 않는다. 새 번호의 ADR을 만들고 기존 문서 상태를 `Superseded`로 바꾼다.
4. Policy를 바꾸는 PR은 영향받는 테스트와 데이터 호환성을 함께 설명한다.
5. 실행하지 않은 검증을 통과했다고 기록하지 않는다.
