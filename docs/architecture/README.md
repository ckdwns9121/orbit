# Architecture

Orbit의 시스템 경계, 데이터 흐름, 품질 속성과 장기 구조를 관리한다.

## 현재 기준

- [System overview](system-overview.md)
- [Context Graph Architecture](../context-graph-architecture.md)
- [Frontend FSD Architecture](../fsd-architecture.md)
- [Architecture template](../templates/architecture-template.md)

## 작성 기준

- 특정 기능 구현보다 오래 유지되는 시스템 경계를 설명한다.
- canonical data와 cache·projection의 소유권을 구분한다.
- trust boundary, 실패 모드, 관측성과 배포 영향을 포함한다.
- 확정된 중요한 선택은 별도 ADR로 연결한다.
