# Product Design

Orbit의 canonical UI/UX 계약은 저장소 루트 [DESIGN.md](../../DESIGN.md)다.

## 참고 순서

1. [DESIGN.md](../../DESIGN.md): 제품 목표, 정보 구조, 시각 언어와 접근성 기준
2. [제품 원칙](../product/product-principles.md): 자동화·집중·신뢰 경계
3. [업무 연속성 PRD](../prd/prd-orbit-work-continuity.md): 사용자 가치와 수용기준
4. 화면별 Technical Design: 중요한 UI 흐름을 구현하기 전 작성

Orca는 고밀도 데스크톱 UI, 패널 구조와 중립적 시각 언어의 레퍼런스다. Orbit은 Orca의 제품 구조나 코드 컴포넌트를 그대로 복제하지 않는다.

## 변경 규칙

- 전역 token, navigation, panel과 공통 interaction 변경은 먼저 `DESIGN.md`를 갱신한다.
- 화면 한 곳에만 필요한 세부 설계는 `docs/technical/td-<feature>.md`에 기록한다.
- 승인된 이미지 기준으로 정밀 구현할 때는 별도의 visual baseline과 검증 결과를 evidence에 남긴다.
