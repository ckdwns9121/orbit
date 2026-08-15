# Dependency Risk Register

- 상태: Accepted
- 소유자: Orbit maintainer
- 작성일: 2026-08-15
- 최종 갱신: 2026-08-15
- 관련 문서: [Tech stack](tech-stack.md), [Release workflow](../../.github/workflows/release.yml)

Orbit의 자동 의존성 경고 중 현재 배포 대상에 직접 적용되지 않거나 업스트림 제약으로 즉시 해결할 수 없는 항목의 판단 근거와 재검토 조건을 기록한다.

## GHSA-wrw7-89jp-8q8g — `glib::VariantStrIter` unsoundness

| 항목 | 판단 |
| --- | --- |
| 심각도 | GitHub UI: Moderate, API: `medium`, CVSS v4 6.9 |
| 취약 범위 | `glib >= 0.15.0, < 0.20.0` |
| Orbit lockfile | `glib 0.18.5` |
| 유입 경로 | Linux 대상의 Tauri 2 → GTK 3/WebKitGTK 전이 의존성 |
| 현재 릴리스 대상 | universal macOS DMG (`app`, `dmg`) |
| 현재 결정 | GitHub `not_used` 사유로 분류하되, 현재 macOS 릴리스 범위에만 적용 |

### Evidence

- GitHub advisory: <https://github.com/advisories/GHSA-wrw7-89jp-8q8g>
- RustSec advisory: <https://rustsec.org/advisories/RUSTSEC-2024-0429.html>
- 취약 코드는 `VariantStrIter` 반복 중 잘못된 out-pointer 처리로 null pointer dereference와 undefined behavior를 유발할 수 있다.
- `cargo tree --manifest-path src-tauri/Cargo.toml --locked --package orbit --target all -i glib`은 Tauri의 Linux GTK/WebKitGTK 경로에서 `glib 0.18.5`가 유입됨을 보여준다.
- `cargo tree --manifest-path src-tauri/Cargo.toml --locked --package orbit --target aarch64-apple-darwin -i glib`과 동일한 `x86_64-apple-darwin` 명령은 의존 경로를 반환하지 않는다.
- 릴리스 워크플로가 별도 feature 옵션 없이 기본 feature set을 사용하므로 검증 명령에도 `--features`, `--all-features`, `--no-default-features`를 추가하지 않았다.
- 릴리스 워크플로는 `universal-apple-darwin`과 `app,dmg`만 빌드한다.
- 현재 Tauri 2 개발 브랜치의 [`crates/tauri/Cargo.toml`](https://github.com/tauri-apps/tauri/blob/df26e1b8ccb0b9e9c4aa4c705a635f59b4a5110a/crates/tauri/Cargo.toml)과 [`crates/tauri-runtime/Cargo.toml`](https://github.com/tauri-apps/tauri/blob/df26e1b8ccb0b9e9c4aa4c705a635f59b4a5110a/crates/tauri-runtime/Cargo.toml)도 Linux에서 `gtk 0.18`을 사용한다. 이 계열은 [2023-10-24 커밋](https://github.com/tauri-apps/tauri/commit/9580df1d7b027befb9e5f025ea2cbaf2dcc82c8e)에서 도입됐다.
- Tauri maintainer는 임시 Cargo patch 또는 GTK 4로 이동하는 Tauri 3을 대안으로 안내했다: <https://github.com/tauri-apps/tauri/issues/12919#issuecomment-2706407744>

### Boundaries

- 이 판단은 macOS 릴리스에만 적용된다. 현재 Rust CI도 `macos-latest`이지만 Linux 개발·빌드·배포를 추가하면 취약 경로가 활성화될 수 있다.
- lockfile 경고를 제거하기 위해 검증되지 않은 git patch를 강제하지 않는다. 현재 배포 바이너리에 포함되지 않는 코드를 위해 공급망 재현성을 낮추는 변경은 하지 않는다.

### Review triggers

다음 조건 중 하나가 발생하면 이 결정을 다시 검토한다.

1. Orbit이 Linux 빌드나 배포를 지원한다.
2. Tauri가 GTK 4 또는 `glib >= 0.20` 계열로 이동한다.
3. advisory의 영향 범위나 exploitability가 변경된다.
4. 2026-11-15 정기 검토일에 도달한다.
5. Apple target dependency graph에 `glib` 경로가 나타나거나 릴리스 feature set이 변경된다.

재검토 시 Linux 대상 테스트, 위의 manifest·lockfile·package·target·feature 조건을 유지한 `cargo tree`, 업스트림 Tauri 의존성 및 GitHub advisory 상태를 다시 확인한다.
