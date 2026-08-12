# 데이터베이스 마이그레이션 정책

- 상태: Accepted

## 정책

1. 배포되었거나 사용자 DB에 적용될 수 있는 migration 파일은 수정·삭제·순서 변경하지 않는다.
2. 잘못된 과거 스키마는 새 번호의 forward-only repair migration으로 교정한다.
3. migration 번호와 Tauri 등록 순서는 단조 증가해야 한다.
4. 새 migration은 빈 DB와 대표적인 기존 DB 양쪽에서 적용을 검증한다.
5. 데이터 보존, trigger, foreign key와 revision protocol을 통합 테스트로 검증한다.
6. migration checksum 불일치가 발생하면 사용자 DB를 초기화해 우회하지 않는다.
7. 스키마 변경 전 사용자 DB 백업과 rollback 불가 영향을 릴리스 문서에 기록한다.
8. canonical data와 재구축 가능한 projection을 구분하며 projection 손상 복구에 canonical table을 수정하지 않는다.

## 근거

- `src-tauri/migrations/`
- `src-tauri/src/lib.rs`
- `src/entities/work-context/api/work-continuity-migration.integration.test.ts`
- `src/entities/work-context/api/migration-trigger.test.ts`
