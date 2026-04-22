# Test fixture coverage matrix

State: **v0.16.5 (2026-04-22)**.

매트릭스는 (parser × structural property)를 표시. 각 셀 값:
- ✅ + filename: 해당 시나리오를 검증하는 fixture 존재
- (CLI) — CLI 렌더 회귀 catching에 포함됨 (`test/visual/fixtures/`)
- (PARSER) — 파서 단위 테스트에 포함됨 (`scripts/test-*.ts` → `dist/test-*.js`)
- N/A — 형식 자체가 해당 속성을 표현 불가
- ⏳ — fixture 추가 필요 (16.x or 17.x)

| Parser            | Anisotropic 격자<br>(γ ≠ 90°) | 부분 점유<br>(`occupancy < 1`) | 자기 모멘트<br>(MAGMOM / `_atom_site_moment_*`) | Anisotropic U<br>(`_atom_site_aniso_U_*`) | 등가곡면 데이터 |
|-------------------|------------|----------|-----------|-----------|----------|
| CIF               | ✅ tio2-rutile.cif (CLI)<br>✅ nd2o3-hex.cif | ✅ test-occupancy.cif (PARSER) | ⏳ CIF moment fixture (16.x) | ✅ test-aniso.cif (PARSER) | N/A |
| POSCAR / VASP     | ✅ stress-20k.poscar (간접) | N/A (format 미지원) | ✅ test-magmom.poscar (PARSER) | N/A | N/A |
| XSF               | ✅ bn-hex.xsf, mos2.xsf, graphene.xsf, LiF-polaron-isolevel.xsf (iso) | N/A | N/A | N/A | ✅ LiF-polaron-isolevel.xsf, h2o.cube (Cube parser) |
| XYZ               | N/A (격자 정보 없음) | N/A | N/A | N/A | N/A |
| PDB               | ✅ alanine.pdb, crambin.pdb | N/A | N/A | N/A | N/A |
| Cube              | N/A (직각 grid 가정) | N/A | N/A | N/A | ✅ h2o.cube |
| CHGCAR / PARCHG   | (확인 필요 — fixture 없음) | N/A | N/A | N/A | ⏳ 신규 fixture (16.x) |
| QE output         | (간접 — si-qe.out) | N/A | N/A | N/A | N/A |
| FHI-aims geometry | ✅ geometry.in | N/A | N/A | N/A | N/A |

## 시각 회귀 (CLI) coverage

`test/visual/fixtures/`에 baseline + scene.json 4개 (16.0 도입):

| Fixture | Parser | Notable |
|---------|--------|---------|
| nacl | CIF | 단순 cubic B1 |
| silicon-supercell | POSCAR | 2×2×2 supercell + multi-bond |
| perovskite | POSCAR | multi-element (Sr, Ti, O) |
| tio2-rutile | CIF | anisotropic lattice + bonds |

ΔRGB 게이트: max ≤ 50, mean < 0.5, p95 < 2 (live render vs baseline PNG).

## Parser 단위 테스트 coverage

`scripts/test-*.ts` → `dist/test-*.js`:

| Test script | 검증 대상 |
|-------------|-----------|
| test-aniso.js | CIF aniso parser, multi-loop refactor, NaN guards (CIF/PDB), occupancy parsing |
| test-symeigen.js | 3×3 symmetric Jacobi eigendecomposition (정확성 + reconstruction) |
| test-magmom.js | POSCAR title-line MAGMOM (collinear/non-collinear/compressed reject) |
| test-wulff.js | Wulff polytope (cube, corner cut, Au cuboctahedron) |

## 누락 (16.x 후보)

1. **CIF magnetic moment fixture** — `_atom_site_moment_*` loop 직접 검증 fixture.
   현재는 parser path만 cifParser.ts에 구현됨 (POSCAR magmom으로 데이터 플로우
   검증).
2. **CHGCAR / PARCHG fixture** — 실제 VASP charge density 파일. 현재 CHGCAR 파서
   존재하지만 fixture 없음.
3. **Symmetry-expanded aniso fixture** — 비-P1 공간군 + aniso로 R·U·Rᵀ rotation
   필요성 노출.
4. **Webview-side parity / 시각 검증 인프라** — 현재 회귀 harness는 CLI Phong
   path 한정. webview-only 기능 (impostor, ellipsoid, magnetic arrow,
   partial occupancy, Wulff) 자동 시각 검증 부재. v0.16.x 후속 인프라.
5. **CHGCAR-aware iso fixture** — iso 회귀 (visual harness가 iso 렌더 변경
   catching).

## TypeScript strictness coverage

Currently active in `tsconfig.json`:
- ✅ `strict` (포괄: strictNullChecks, strictFunctionTypes, strictBindCallApply,
  strictPropertyInitialization, noImplicitThis, alwaysStrict, noImplicitAny,
  useUnknownInCatchVariables)
- ✅ `noImplicitReturns` (16.5 신규 활성)
- ✅ `noFallthroughCasesInSwitch` (16.5 신규 활성)

Deferred:
- ⏳ `noUncheckedIndexedAccess` — 949 에러 (16.5 진단). 일괄 fix 시 array access
  마다 `if (x !== undefined)` guard 추가 필요. 가독성 trade-off + 작업 비용 큼.
  v0.16.x 점진 적용 (모듈별 — parsers/ 부터).
- ⏳ `noPropertyAccessFromIndexSignature` — 분석 안 함; map-heavy 코드에서
  `obj['key']` 강제 → 가독성 악화.
- ⏳ `exactOptionalPropertyTypes` — 옵셔널 필드 (16.0 신규) 패턴과 충돌 우려.
