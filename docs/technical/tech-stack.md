# Orbit Tech Stack and Engineering Standards

- 상태: Accepted
- 소유자: Orbit maintainer
- 작성일: 2026-08-15
- 최종 갱신: 2026-08-15
- 관련 문서: [System Architecture](../architecture/system-overview.md), [DESIGN.md](../../DESIGN.md)

## Runtime and platform

| 영역 | 기술 | 책임 |
| --- | --- | --- |
| Desktop | Tauri 2 | window, command bridge, bundle |
| Native backend | Rust 2021 | 외부 API, OAuth, Keychain, native capability |
| Frontend | React 19, TypeScript 5.8 | UI와 사용자 흐름 |
| Tooling | Vite 7, Bun 1.3 | build, package, frontend test |
| Persistence | SQLite, Tauri SQL plugin | canonical state, cache, graph projection |
| Styling | Sass/SCSS, semantic CSS variables | theme와 component styling |
| Icons | Lucide React | 일관된 UI iconography |
| Delivery | GitHub Actions, Tauri Action | CI와 macOS release |

정확한 버전은 `package.json`, `bun.lock`, `src-tauri/Cargo.toml`을 기준으로 한다.

## Source boundaries

```text
src/
├── app/       application shell, bootstrap, navigation
├── pages/     route-level composition
├── widgets/   reusable cross-feature composition
├── features/  user actions and use cases
├── entities/  domain model and repositories
└── shared/    domain-agnostic UI, styles and utilities
```

의존 방향은 `app → pages → widgets → features → entities → shared`이며 `bun run verify:fsd`로 검증한다.

## Data standards

- SQLite migration은 forward-only이며 기존 번호를 수정·삭제하지 않는다.
- canonical table, external cache와 projection을 명확히 구분한다.
- 상태 변경은 revision 검증과 transaction 경계를 사용한다.
- 시간은 저장 시 UTC ISO-8601, 표시 시 사용자 locale/timezone을 사용한다.
- 외부 source row에는 provenance와 freshness를 보존한다.

## Integration standards

- 인증정보는 macOS Keychain에만 저장한다.
- 외부 API 읽기는 timeout, scope, cache freshness와 실패 상태를 정의한다.
- 외부 쓰기는 preview → approval → validation → outbox → reconciliation을 따른다.
- OAuth는 시스템 브라우저, PKCE와 최소 scope를 사용한다.

## Frontend standards

- 공통 시각 계약은 루트 [DESIGN.md](../../DESIGN.md)를 따른다.
- raw hex, 임의 spacing·radius보다 semantic token을 우선한다.
- 비동기 화면은 loading, empty, stale, failed, success 상태를 구분한다.
- 긴 목록은 pagination 또는 virtualization을 사용한다.
- icon-only button에는 accessible name을 제공한다.

## AI standards

- AI는 사용자 요청을 정규화하고 사용할 tool과 입력을 구조화한다.
- retrieval 결과의 출처, 기간과 실패한 source를 답변에 포함한다.
- mutation은 preview와 승인 없이 실행하지 않는다.
- 모델 출력은 schema validation 후 사용하고 raw secret을 전달하지 않는다.

## Required verification

```bash
bun run verify:fsd
bun run build
bun test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
bun run release:check
```

변경 범위에 따라 migration integration test, OAuth mock, visual screenshot과 실제 외부 staging 검증을 추가한다. 실행하지 않은 검증은 문서에 PASS로 기록하지 않는다.

## Delivery

- `main` 변경은 CI를 통과해야 한다.
- release tag, package, Tauri와 Cargo 버전은 일치해야 한다.
- 배포 빌드는 universal macOS app과 DMG를 생성한다.
- 서명·notarization secret은 GitHub Actions secret으로만 관리한다.
