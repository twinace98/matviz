# vscode-matviz — Master Plan

## Context

VESTA-inspired crystal structure viewer as a VSCode extension. Goal: provide computational materials scientists with a fast, integrated 3D viewer that handles common file formats without leaving the editor.

**Decisions locked in**:
- Two-bundle architecture (Node.js extension host + browser webview) — not changing
- Three.js as rendering engine — committed
- `InstancedMesh` for atoms, instanced cylinders for bonds — performance-critical
- On-demand rendering (no continuous rAF loop)

**Critical caveats**:
- Webview CSP must remain strict (nonce-only scripts). Current CSP still allows `'unsafe-inline'` for styles — slated for removal in v0.13.1.
- Element data is duplicated across **three** bundles (`parsers/elements.ts`, `webview/elements-data.ts`, and the inline table in `scripts/render.ts`) — currently drifted (see v0.13.1). Long-term fix: single source of truth.
- Bond detection is O(N) via spatial hashing but skipped hard for >5000 atoms (no UI indication — v0.14 should surface this).

---

## Completed versions

| Version | Summary |
|---------|---------|
| v0.1 | Initial viewer: CIF/POSCAR/XSF, ball-and-stick, supercell |
| v0.2 | Performance: on-demand rendering, instanced bonds, spatial hashing, adaptive LOD |
| v0.3 | View modes: ortho camera, 4 display styles, atom labels, depth fog |
| v0.4 | Navigation: axis views, constrained rotation, keyboard controls |
| v0.5 | Bonds & polyhedra: per-pair parameters, periodic boundary search, coordination polyhedra |
| v0.6 | Selection & measurement: atom picking, distance/angle/dihedral |
| v0.7 | Symmetry: CIF symmetry expansion, lattice planes, unit cell info |
| v0.8 | Volumetric: CHGCAR/Cube/XSF isosurface via marching cubes |
| v0.9 | Properties: per-element color/radius/visibility, per-bond parameters, session persistence |
| v0.10 | Formats & export: XYZ, PDB, QE, FHI-aims parsers; screenshot; CIF/POSCAR export |
| v0.11 | UI overhaul: dark/light palette, rotation sensitivity fix, clipping fix |
| v0.12 | Rendering fixes: boundary wrap, stick style, bond defaults, adaptive top-bar, collapsible side panel, canvas sizing |
| v0.13 | Headless CLI renderer (Puppeteer + SwiftShader), Claude `matviz-render` skill; XSF/CHGCAR isosurface axis-order hotfix (Fortran→C layout) |

---

## v0.13.1 — Hardening hotfix (from 2026-04-17 code review)

**Goal**: Close correctness and reliability gaps surfaced by the full-project review before starting UX work. Small, bounded patch release.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 13.1.1 | Unify element tables — single source of truth shared by extension, webview, and CLI | All three tables generated from one data module; CI (or build step) fails on drift. 12 missing lanthanides (Pr, Nd, Sm, Eu, Gd, Tb, Dy, Ho, Er, Tm, Yb, Lu) present in webview |
| 13.1.2 | Editor error boundary: wrap `parseStructureFile()` in `crystalEditorProvider.ts:52` with try/catch; show error toast + "Open as text" fallback | Malformed `.out`/`.cif`/`.poscar` no longer yields an unusable blank editor |
| 13.1.3 | Narrow `*.out` association heuristic (QE shape check before claiming the editor) | Non-QE `.out` files (compiler logs, generic output) open as text by default |
| 13.1.4 | Inline-material registry in `renderer.ts` — track every inline `Material` allocation (plane, iso, axis, measurement, bond wireframe, polyhedron, labels, cell) for disposal in `disposeResources()` | No VRAM growth across 50 rebuild cycles (measure via `renderer.info.memory`) |
| 13.1.5 | CLI renderer `try/finally` around Puppeteer browser lifecycle in `scripts/render.ts:717-792` | Exceptions in `readFileSync` / `parseStructureFile` / `page.goto` close the browser cleanly |
| 13.1.6 | Tighten webview CSP — drop `'unsafe-inline'` from `style-src` in `crystalEditorProvider.ts:130` | Loaded webview has no inline `<style>` violations; styles.css continues to load |

**Non-goals (explicitly deferred)**:
- Renderer split (BondRenderer / AxisIndicator / MaterialRegistry extractions) → v0.14+
- Parser NaN guards for degenerate geometry (γ=0/180, a=b=c=0) → track in tech-debt registry below
- CLI element-table parity fix is folded into 13.1.1

**Exit criterion**: All six items land with a manual test pass on the v0.13 test fixtures + a structure containing a lanthanide. Tagged v0.13.1.

---

## v0.14 — UX polish

**Goal**: Improve daily-use ergonomics — responsive layout, side panel behavior, toolbar discoverability.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 14.1 | Side panel layout mode (canvas offset vs overlay) | Canvas never hidden by panel; drag-resize works |
| 14.2 | Responsive toolbar breakpoints (compact/normal/wide) | All buttons accessible at 400px–2000px editor width |
| 14.3 | Keyboard shortcut discoverability (tooltips, help overlay) | First-time user can discover all shortcuts in <30s |
| 14.4 | State persistence improvements | Camera position, panel collapsed state, all settings restored on reopen |
| 14.5 | Performance profiling & budget enforcement | Draw calls <100, idle GPU = 0 frames, memory <100MB |
| 14.6 | Bond cutoff UX — when >5000 atoms skips bond detection, show an inline hint in the side panel | User understands why bonds are absent; can raise the cap with one click |
| 14.7 | First pass of `renderer.ts` split — extract `AxisIndicator` component (owns its own geometries, materials, textures, disposal) | `renderer.ts` drops by ~60 LOC; axis rebuild no longer leaks |

**Exit criterion**: All features work across light/dark themes at editor widths from 400px to 2000px.

---

## v0.15 — Advanced rendering

**Goal**: GPU-efficient rendering for large structures (>10k atoms).

| # | Feature | Success criterion |
|---|---------|-------------------|
| 15.1 | Sphere impostors (billboard + fragment shader) | Pixel-perfect spheres, triangle count reduced 10x vs geometry spheres |
| 15.2 | GPU-accelerated picking | Picking <5ms for 50k atoms |
| 15.3 | Frustum culling for instanced meshes | No rendering of off-screen atoms |
| 15.4 | WebGPU backend evaluation | Prototype renders on WebGPU; decision gate on whether to commit |

**Decision gate after 15.4**: WebGPU stable enough for production? If yes, migrate pipeline. If no, stay WebGL2 and revisit in 6 months.

**Exit criterion**: 50k-atom structure renders at 30fps during rotation.

---

## v0.16 — Extended crystallography

**Goal**: Display advanced crystallographic properties.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 16.1 | Thermal ellipsoids (anisotropic displacement from CIF) | Ellipsoids match VESTA for reference structure |
| 16.2 | Partial occupancy display | Pie-chart spheres or transparency for mixed sites |
| 16.3 | Magnetic moment vectors | Arrows on atoms, correct direction and relative magnitude |
| 16.4 | Crystal morphology (external shape from Miller indices) | Wulff construction renders correctly for cubic example |

**Exit criterion**: All features toggle independently without affecting base rendering.

---

## v0.17 — Animation & multi-structure

**Goal**: Support dynamic structures and comparisons.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 17.1 | MD trajectory playback (multi-frame XSF, XDATCAR) | Smooth playback at 30fps, scrub slider, play/pause |
| 17.2 | Multi-phase overlay | Two structures rendered simultaneously with offset/transparency |
| 17.3 | Structure comparison mode | Side-by-side or overlay with difference highlighting |

**Exit criterion**: 1000-frame XDATCAR plays without memory leak.

---

## v0.18 — Editor integration

**Goal**: Deep VSCode integration for power users.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 18.1 | Split-pane: text editor + 3D view | Edit CIF text, 3D view updates live |
| 18.2 | VSCode settings namespace (`matviz.*`) | All defaults configurable; settings UI works |
| 18.3 | Undo/redo for property changes | Ctrl+Z restores previous colors/radii/cutoffs |
| 18.4 | Marketplace publishing | Extension installable from VSCode marketplace |

**Exit criterion**: Published on marketplace with all documented features working.

---

## Critical decision gates

1. **After 15.4 (WebGPU evaluation)** — pass criterion: WebGPU renders all test fixtures correctly with ≥30fps on Chrome. On fail: stay WebGL2, remove WebGPU code.
2. **Before 18.4 (marketplace publishing)** — pass criterion: all test fixtures render correctly, no console errors, README accurate. On fail: fix before publishing.

---

## Verification strategy

- **v0.14**: Manual testing at multiple editor widths (400/800/1200/2000px) across light/dark themes.
- **v0.15**: Performance benchmarks with `renderer.info` and `performance.now()` on 10k/50k atom structures.
- **v0.16**: Visual comparison with VESTA screenshots for reference structures.
- **v0.17**: Memory profiling during 1000-frame playback; leak detection via heap snapshots.
- **v0.18**: VSCode marketplace validation checklist; end-to-end install test on clean machine.

---

## Performance budget

| Metric | Target | Measurement |
|--------|--------|-------------|
| Draw calls | <100 per frame | `renderer.info.render.calls` |
| Idle GPU | 0 frames | Performance tab: no rAF activity |
| Bond detection | O(N), <200ms for 10k atoms | `performance.now()` |
| Atom picking | <16ms | `performance.now()` |
| Isosurface 64³ | <500ms | `performance.now()` |
| Memory (no volumetric) | <100MB | DevTools heap |
| Style switch | <50ms, no bond re-detection | Visual + timing |

---

## Tech-debt registry (from 2026-04-17 code review)

Tracked separately so individual items can slot into any version patch without rewriting the plan. Order is rough priority.

| Area | Item | File:line | Proposed slot |
|------|------|-----------|----------------|
| Renderer | Redundant condition on negative isosurface branch — collapse `if (isoLevel > 0)` duplicate into one block calling marching cubes twice | `src/webview/renderer.ts:492, 510` | v0.14.7 (with AxisIndicator extraction) |
| Renderer | Split `renderer.ts` (2019 LOC) further — `BondRenderer`, `MaterialRegistry` after AxisIndicator | `src/webview/renderer.ts` | v0.15 prep |
| Parsers | Degenerate-lattice NaN guards (γ=0/180, a=b=c=0) | `src/parsers/cifParser.ts:366`, `pdbParser.ts:66` | v0.16 (extended crystallography touches these anyway) |
| Parsers | XYZ numeric atomic-number fallback returns `'X'` — should call `getElementByNumber` like XSF | `src/parsers/xyzParser.ts:47-52` | any patch |
| Parsers | QE parser silently returns default 10×10×10 lattice on parse failure — should throw so 13.1.2 error boundary triggers | `src/parsers/qeParser.ts:85-86` | v0.13.1 (helps 13.1.2/13.1.3) |
| Parsers | Auto-detect CIF via `content.includes('_cell_length_a')` — naive, gated only by prior filename checks | `src/parsers/index.ts:61` | low; keep noted |
| Parsers | Dead branch: aims check in `.in`-or-`.out` block, but `.out` short-circuits earlier | `src/parsers/index.ts:41` | trivial cleanup |
| Shared | Duplicate `BOHR_TO_ANG` constant | `src/parsers/cubeParser.ts:4`, `qeParser.ts:3` | trivial cleanup |
| Renderer | Axis label `CanvasTexture` (line 889) not pushed to `this.textures` | `src/webview/renderer.ts:889` | covered by 14.7 |

---

## Known-solid (verified during 2026-04-17 review — leave alone)

- Marching cubes (`webview/marchingCubes.ts`) — interpolation, winding, normal generation correct.
- XSF/CHGCAR Fortran→C reorder fix from v0.13.0 — verified against `marchingCubes.ts:29` indexing.
- Boundary-atom wrap into [0,1) + supercell expansion — dedup logic and edge handling sound.
- InstancedMesh discipline — `updateMatrix()` before `setMatrixAt()`, `instanceMatrix.needsUpdate = true`.
- Canvas sizing — `renderer.setSize(w, h, false)` preserves CSS layout (locked decision upheld).
- Extension-host surface — CSP nonce per-panel, `localResourceRoots` locked to `dist`/`media`, `asWebviewUri` throughout; export uses native `showSaveDialog` (no path traversal); webview inbound messages restricted to `ready`/`openAsText`.
- `scripts/install-skill.sh` — properly hardened (`set -euo pipefail`, quoted expansions).
