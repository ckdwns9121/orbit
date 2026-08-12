# [ADR-002] 로컬 우선 SQLite 저장

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

Orbit은 개인 Mac에서 AI 세션과 여러 업무 도구의 컨텍스트를 통합한다. 네트워크와 별도 서버에 의존하면 오프라인 사용, 운영 비용, 개인 업무 데이터의 보관 범위와 장애 복구가 복잡해진다. 동시에 관계·검색·migration·원자적 상태 전이를 지원하는 영속 저장소가 필요하다.

## Decision

Task와 integration cache의 canonical local store로 SQLite를 사용한다. 외부 서비스가 원본인 데이터는 provenance와 freshness를 보존하며, 인증정보는 SQLite가 아닌 macOS Keychain에 저장한다.

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| 로컬 SQLite | 단일 파일, transaction, index, migration과 오프라인 사용 지원 | 다중 기기·협업 동기화가 기본 제공되지 않음 |
| localStorage/JSON | 구현이 단순함 | 관계 무결성, 대량 검색, transaction과 migration이 취약함 |
| 클라우드 DB | 다중 기기와 협업 확장에 유리함 | 서버 운영, 로그인, 개인정보와 오프라인 복잡도 증가 |

**최종 결정:** 현재 개인용 데스크탑 범위에서는 SQLite를 canonical local store로 사용한다.

## Reference

- [인증정보와 보안 정책](../policies/credential-security-policy.md)
- [데이터베이스 마이그레이션 정책](../policies/database-migration-policy.md)
- `src/entities/work-context/api/database.ts`
