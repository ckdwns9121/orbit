# Orbit Documentation

Orbit의 제품 요구사항, 디자인, 아키텍처, 기술 결정, 정책과 검증 증거를 관리하는 문서 허브다. 코드가 현재 동작을 보여준다면 문서는 **무엇을 왜 만들고, 어떤 경계를 지키며, 결과를 어떻게 검증하는지**를 설명한다.

## Start here

| 목적 | 먼저 읽을 문서 |
| --- | --- |
| Orbit이 해결하는 문제 이해 | [제품 문제 정의](product-problem.md) |
| 제품 범위와 수용기준 확인 | [업무 연속성 PRD](prd/prd-orbit-work-continuity.md) |
| UI/UX 구현 | [DESIGN.md](../DESIGN.md) |
| 시스템 전체 구조 이해 | [System Architecture](architecture/system-overview.md) |
| 기술 스택과 개발 규칙 확인 | [Tech Stack](technical/tech-stack.md) |
| 기존 결정의 이유 확인 | [Architecture Decision Records](ADR/README.md) |
| 새 문서 작성 | [문서 운영 가이드](documentation-guide.md), [Templates](templates/README.md) |

## Information architecture

```text
Product → PRD → Spec → RFC/Architecture → Technical Design → ADR
                              ↓                    ↓
                           Policy              Evidence
                              ↓                    ↑
                            Code ───────────── Verification
```

| 영역 | 소유하는 질문 | 인덱스 |
| --- | --- | --- |
| Product | 누구의 어떤 문제를 푸는가? | [product/](product/README.md) |
| PRD & Spec | 무엇을 만들고 어떻게 동작해야 하는가? | [prd/](prd/README.md) |
| Design | 어떤 경험과 시각 언어를 제공하는가? | [design/](design/README.md) |
| Architecture | 시스템 경계와 품질 속성은 무엇인가? | [architecture/](architecture/README.md) |
| Technical | 구체적으로 어떻게 구현·운영하는가? | [technical/](technical/README.md) |
| ADR | 무엇을 결정했고 왜 선택했는가? | [ADR/](ADR/README.md) |
| Policy | 무엇을 항상 지켜야 하는가? | [policies/](policies/README.md) |
| Evidence | 요구사항이 실제로 충족됐는가? | [evidence/](evidence/README.md) |
| Templates | 새 문서를 어떻게 시작하는가? | [templates/](templates/README.md) |

## Canonical documents

### Product and requirements

- [제품 문제 정의](product-problem.md)
- [제품 솔루션 제안](product-solution.md)
- [제품 원칙](product/product-principles.md)
- [업무 연속성 PRD](prd/prd-orbit-work-continuity.md)
- [업무 연속성 Spec](prd/spec-orbit-work-continuity.md)

### Design and architecture

- [Orbit Design Contract](../DESIGN.md)
- [System Architecture](architecture/system-overview.md)
- [Context Graph Architecture](context-graph-architecture.md)
- [Frontend FSD Architecture](fsd-architecture.md)
- [Tech Stack and Engineering Standards](technical/tech-stack.md)

### Policies

- [Task 생명주기](policies/task-lifecycle-policy.md)
- [집중과 중단](policies/focus-and-interruption-policy.md)
- [완료 기록](policies/completion-policy.md)
- [외부 연동과 동기화](policies/integration-sync-policy.md)
- [AI 자동화](policies/ai-automation-policy.md)
- [인증정보와 보안](policies/credential-security-policy.md)
- [데이터베이스 마이그레이션](policies/database-migration-policy.md)

### Decisions

- [ADR-001 Task를 업무 SSOT로 사용](<ADR/[ADR-001] Task를 업무 SSOT로 사용.md>)
- [ADR-002 로컬 우선 SQLite 저장](<ADR/[ADR-002] 로컬 우선 SQLite 저장.md>)
- [ADR-003 단일 집중 슬롯](<ADR/[ADR-003] 단일 집중 슬롯.md>)
- [ADR-004 완료 기록과 근거 스냅샷의 원자적 저장](<ADR/[ADR-004] 완료 기록과 근거 스냅샷의 원자적 저장.md>)
- [ADR-005 Context Graph를 재구축 가능한 Projection으로 운영](<ADR/[ADR-005] Context Graph를 재구축 가능한 Projection으로 운영.md>)
- [ADR-006 프런트엔드 FSD 의존 방향 적용](<ADR/[ADR-006] 프런트엔드 FSD 의존 방향 적용.md>)
- [ADR-007 Google Calendar에 공용 데스크톱 OAuth 클라이언트 사용](<ADR/[ADR-007] Google Calendar에 공용 데스크톱 OAuth 클라이언트 사용.md>)

### Evidence and historical context

- [업무 연속성 수용 증거](work-continuity-acceptance-evidence.md)
- [제품 우선순위 회의록 (2026-08-06)](meeting-notes-product-priority-2026-08-06.md)

기존 루트 문서는 링크 호환성을 위해 유지한다. 내용이 크게 변경될 때 현재 정보 구조로 이동하고 모든 참조를 함께 갱신한다.

## Document lifecycle

```text
Draft → Proposed → Accepted → Implemented
                      ├──────→ Superseded
                      └──────→ Deprecated
```

- 상태 의미, 파일 이름과 metadata 규칙은 [문서 운영 가이드](documentation-guide.md)를 따른다.
- Architecture·Policy를 바꾸는 구현은 관련 ADR을 검토한다.
- UI system 변경은 코드보다 먼저 [DESIGN.md](../DESIGN.md)를 갱신한다.
- 실행하지 않은 검증은 Evidence에 PASS로 기록하지 않는다.
- secret, 실제 고객명과 비공개 업무 데이터는 문서와 이미지에 포함하지 않는다.

## Change map

```text
문제·사용자 가치 변경       → Product brief 또는 PRD
기능 계약·상태 변경         → PRD AC + Spec
여러 대안의 합의 필요       → RFC
시스템 경계 변경            → Architecture + RFC + ADR
중요 구현·migration 변경    → Technical Design + ADR/Policy 검토
디자인 시스템 변경          → DESIGN.md + Technical Design
검증 완료                   → Evidence + 문서 상태 갱신
```

## Templates

- [Product brief](templates/product-brief-template.md)
- [PRD](templates/prd-template.md)
- [Feature Spec](templates/spec-template.md)
- [RFC](templates/rfc-template.md)
- [Architecture](templates/architecture-template.md)
- [Technical Design](templates/technical-design-template.md)
- [ADR](templates/adr-template.md)
- [Policy](templates/policy-template.md)
- [Evidence](templates/evidence-template.md)
- [Meeting note](templates/meeting-notes-template.md)
