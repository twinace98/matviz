# vscode-matviz — Master Plan

## Context

VESTA-inspired crystal structure viewer as a VSCode extension. Goal: provide computational materials scientists with a fast, integrated 3D viewer that handles common file formats without leaving the editor.

**Decisions locked in**:
- Two-bundle architecture (Node.js extension host + browser webview) — not changing
- Three.js as rendering engine — committed
- `InstancedMesh` for atoms, instanced cylinders for bonds — performance-critical
- On-demand rendering (no continuous rAF loop)

**Critical caveats (current)**:
- Webview CSP is nonce-only for scripts AND styles (`'unsafe-inline'` dropped in v0.13.1). Any new inline style must land as a utility class in `media/styles.css` instead.
- Element data single source: `src/shared/elements-data.ts` (80 elements). Extension host and webview both import from here. `scripts/render.ts` deliberately inlines a **subset** because the HTML page must be self-contained for Puppeteer — keep colors/radii in sync manually when elements-data.ts changes (documented in CLAUDE.md).
- Bond detection is O(N) via spatial hashing, hard-skipped for >5000 atoms. UI surfaces this with a "Bond detection skipped / Compute anyway" inline hint (v0.14.0).
- Custom editor is `CustomReadonlyEditorProvider<CrystalDocument>` — writing back to the file requires moving to the editable variant, which affects v0.18.1 (split-pane) design.
- Impostor rendering tone does not exactly match the Phong-material path despite `RECIPROCAL_PI` + `linearToSRGB` alignment (shipped v0.15.0 known issue). Targeted for v0.15.1.
- **Isosurface supercell requires periodic data**. `tileVolumetricPBC` + single-MC expects the volumetric grid to be truly periodic (DFT CHGCAR/XSF always are). Non-periodic cube files (like molecules in vacuum) will show visible seams between tiled cells. Also `marchingCubes(..., pbc=true)` is required for the iso to reach the exact cell boundary — only `buildIsosurface` should pass `pbc=true`; other callers (if any appear) keep the default `pbc=false`.
- **Polyhedra centers auto-detect is chemistry-heuristic, not a universal truth**. The first-coord-shell + 85%-dominant-ligand rule works for typical ionic/covalent crystals (NaCl, TiO2, perovskites, spinels, ZnO) but will exclude: (1) clusters with mixed-element ligand shells like ABO3's bridging O, (2) pure metallic fcc/bcc (homoatomic coordination). Users can always override via the side-panel checkboxes.

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
| v0.13.1 | Hardening pass: shared element data (80 elements, lanthanide fill), editor parse-error boundary with "Open as Text" fallback, narrowed `.out/.in` editor priority, CSP drops `'unsafe-inline'`, QE parser throws on empty, material registry disposes inline allocations, CLI renderer browser `try/finally` |
| v0.14 | UX polish: sidebar layout modes (offset default, overlay preserved), CSS-container-query responsive toolbar, keyboard shortcut modal (`?`), bond-skip hint with "Compute anyway" (>5000 atoms), persisted state schema v1 (layout/panel/visibility/element & bond overrides/iso/axis), AxisIndicator extraction, 16k-atom diamond stress fixture |
| v0.15 | Advanced rendering: sphere + cylinder impostors (billboard + ray intersection + `gl_FragDepth`), chunked InstancedMesh frustum culling (spatial binning per element), hybrid GPU picking (1×1 render target, N≥5000 threshold), BondRenderer extraction, angle/dihedral measurement dashed outlines. **WebGPU backend evaluation rejected** (cost/benefit). Known issue: impostor path slightly brighter than Phong (tracked for v0.15.1) |

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

## v0.14 — UX polish ✅ shipped 2026-04-17

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

## v0.15 — Advanced rendering ✅ shipped 2026-04-18

**Goal**: GPU-efficient rendering for large structures (>10k atoms).

| # | Feature | Success criterion |
|---|---------|-------------------|
| 15.0 | `BondRenderer` extraction from `renderer.ts` | Bond lifecycle (geometry, materials, instanced attrs) owned by standalone module; disposable independently |
| 15.1 | Sphere impostors (billboard + fragment shader + `gl_FragDepth`) | Pixel-perfect spheres, triangle count reduced ~10× vs geometry spheres |
| 15.2 | GPU-accelerated picking (1×1 render target, `camera.setViewOffset`, hybrid threshold N≥5000) | Picking <5ms for 50k atoms; below threshold, CPU raycaster path preserved |
| 15.3 | Frustum culling for instanced meshes (chunked InstancedMesh via spatial binning per element) | Off-screen chunks skipped; no per-instance CPU culling cost |
| 15.4 | WebGPU backend evaluation ❌ rejected | 2026-04-18 cost/benefit review — GLSL shaders would need TSL port, WebGL2 path already optimized, CLI renderer tied to SwiftShader (WebGL2 only). Revisit when 50k+ structures actually bottleneck on WebGL2 or compute-shader redesign enters scope (v0.17+). |
| 15.5 | Cylinder impostor for bonds (bicolor split at midpoint, ray-cylinder intersection, `gl_FragDepth`) | Bonds render without tessellated cylinders; parity with BondRenderer geometry path |

**Decision gate after 15.4**: ❌ **Rejected 2026-04-18** (without prototyping). Stay WebGL2. Reasons and revisit conditions in `plans/archives/v0.15_advanced-rendering_impl.md` section 15.4.

**Exit criterion**: 50k-atom structure renders at 30fps during rotation. ⚠ Not explicitly benchmarked on 50k fixture — verified qualitatively on 16k-atom diamond stress fixture. Formal measurement tracked under test infrastructure (see below).

**Known issue (deferred to v0.15.1)**: Impostor path renders slightly brighter/more saturated than Phong path. Suspected tone/sRGB mapping mismatch in fragment output (impostor writes linear, Phong pipeline applies tone map).

---

## v0.15.1 — Impostor color polish + visual regression harness (proposed patch)

**Goal**: Fix impostor vs Phong tone/saturation drift, and land the render-snapshot harness that makes this (and every future rendering change) objectively measurable rather than eyeballed. Bundling avoids rebuilding the same harness at v0.16.

**Root-cause hypothesis** (to be confirmed by 15.1.1): impostor fragment shaders emit linear color without applying the active `toneMapping` or sRGB output-colorspace conversion, so `WebGLRenderer` (outputColorSpace = sRGB) applies the sRGB encode on top, producing a brighter/more saturated result than the Phong path which already runs the standard tone/colorspace chunks.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 15.1.0 | Visual-regression harness via CLI renderer | `--impostor on\|off` flag on `scripts/render.ts`; `scripts/compare-impostor.ts` renders each fixture twice and runs `pixelmatch` → prints ΔRGB histogram (max / mean / p95) and emits PNG diff; CI-friendly exit code |
| 15.1.1 | Diagnose mismatch using the harness | Log current `outputColorSpace`, `toneMapping`, and impostor-frag output space; confirm whether Phong and impostor share tone/colorspace chunks. Baseline ΔRGB numbers recorded before fix |
| 15.1.2 | Apply matching tone/colorspace in sphere + cylinder impostor shaders | Add `#include <tonemapping_fragment>` and `#include <colorspace_fragment>` (Three.js 0.170 chunks) — or equivalent manual `LinearTosRGB` + active tone map — to sphere + cylinder fragment shaders |
| 15.1.3 | Wire harness into `npm test` (or `npm run test:visual`) + fixtures | Fixtures committed under `test/visual/impostor-parity/fixtures/` (NaCl, silicon 2×2×2, 16k diamond, and one multi-element for color-spectrum coverage); diffs go to `test/visual/impostor-parity/diff/` and are `.gitignore`d |

**Fixed scene controls**: identical HTML template, camera pose, palette, lighting, tone map, atoms-and-bonds on, selection/measurement off. The only toggle between the two renders is impostor on/off. No RNG in the render path.

**Scope guardrail**: No new rendering features. If diagnosis uncovers a structural fix (e.g. lighting model divergence between Phong and impostor), stop and defer to v0.16 kickoff instead of expanding v0.15.1.

**Exit criterion**: For every fixture, **p95 ΔRGB < 2** and **mean ΔRGB < 0.5** (0–255 scale). Eyeball check is a sanity pass on top, not the gate.

**Deliverables fold-in**: supersedes the "render snapshot regression" item in the Test infrastructure section and the "impostor vs Phong tone/sRGB mismatch" entry in the tech-debt registry.

**Estimated effort**: ~1.5 days — majority in 15.1.0 harness work, which is reused for all later rendering changes (v0.16 thermal ellipsoids, v0.17 trajectory playback).

---

## v0.15.2 — Polyhedra + iso polish (unreleased; on `main`)

Two fix commits already landed on `main` after v0.15.0; version bump pending user decision (standalone v0.15.2 vs. bundle into v0.15.1 vs. fold into v0.16 kickoff).

| # | Fix | Commit |
|---|-----|--------|
| 15.2.a | Polyhedra overhaul — `ConvexGeometry` replaces hand-rolled hull; per-element "Polyhedra centers" side-panel UI with auto-detect via first-coordination-shell + aggregated-ligand-purity; `showPolyhedra` no longer restored from saved state so matviz init always shows polyhedra off; CLI `--polyhedra-centers Ti,Fe` flag | `1d1ea8a` |
| 15.2.b | Isosurface supercell + caps + PBC — data tiled PBC to supercell, single MC pass, 6 outer-face caps via 2D `marchingSquaresFill`; `marchingCubes` gains `pbc` flag so iso reaches exact boundary; b-face cap slice axis-order bug fixed | `e495ba0` |

**Exit criterion (if released as v0.15.2)**: manual verification pass on `perovskite`, `tio2-rutile`, `nacl`, `zno` (polyhedra) and a periodic CHGCAR/XSF fixture with supercell > 1 (iso caps). Both already confirmed in session.

---

## v0.16 — Extended crystallography ✅ shipped 2026-04-22 (in v0.17.3 bundled release 2026-04-23)

**Goal**: Display advanced crystallographic properties.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 16.1 | Thermal ellipsoids (anisotropic displacement from CIF `_atom_site_aniso_U_*` / `_atom_site_aniso_B_*`) | Ellipsoids match VESTA for reference structure (e.g. calcite, anorthite); probability contour configurable (50%/90%) |
| 16.2 | Partial occupancy display (parse `_atom_site_occupancy`; render as sectored sphere or weighted transparency) | Mixed-occupancy sites render at correct occupancy ratio; toggle between pie-chart and transparency modes |
| 16.3 | Magnetic moment vectors (parse VASP `MAGMOM` / CIF `_atom_site_moment`) | Arrows on atoms, length ∝ magnitude, direction correct; toggle on/off; colormap by magnitude |
| 16.4 | Crystal morphology (external shape from Miller indices) | Wulff construction renders correctly for cubic example (Au fcc); per-face energy configurable |

**Open questions**:
- CIF `_atom_site_aniso_*` parsing requires extending `cifParser.ts` — currently drops non-position site columns. Budget: ~1 day for parser + data flow changes.
- Thermal ellipsoid geometry: reuse InstancedMesh (scale-per-axis via per-instance matrix) vs per-atom `Mesh` with Eigen decomposition. Default: InstancedMesh with full 4×4 matrix per instance (no new shader).
- Partial occupancy: VESTA uses sectored spheres. This requires a custom shader or multi-material mesh. Alternative: stacked transparent spheres (simpler but worse anti-aliasing).
- Magnetic moment parsing overlaps with v0.17 multi-frame (MAGMOM can vary per frame). Decide scope boundary at 16.3 kickoff.

**Dependencies**:
- Element data layer is stable post-v0.13.1; no changes needed.
- Impostor path (v0.15) must absorb new per-instance attributes cleanly — verify before starting 16.1.

**Exit criterion**: All features toggle independently without affecting base rendering; reference structures visually match VESTA screenshots.

---

## v0.17 — Animation & multi-structure ✅ shipped 2026-04-23 (v0.17.0 + v0.17.1 + v0.17.2 + v0.17.3 bundled)

**v0.17.0** (Animation): 17.1.0 trajectory bridge + 17.1.1 AXSF + 17.1.2 XDATCAR (NVE+NPT) + 17.1.3 extended XYZ + 17.1.4 playback UI + 17.1.5 bond toggle + 17.2 multi-phase overlay. 17.3 (comparison) pre-split.
**v0.17.1** (Comparison): 17.3.0 NN matching + 17.3.1 displacement renderer/UI.
**v0.17.2** (UX/correctness patch): unified Phases+Comparison UI + playback UX polish + PBC-aware NN + RMSD summary panel.
**v0.17.3** (Trajectory CLI): `--frame N` + `--all-frames` for matviz-render skill MD-animation workflow.

**Goal**: Support dynamic structures and comparisons.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 17.1 | MD trajectory playback (multi-frame XSF — AXSF; XDATCAR; extended XYZ) | Smooth playback at 30fps for N=1k atoms × 1000 frames; scrub slider, play/pause, frame number display |
| 17.2 | Multi-phase overlay | Two structures rendered simultaneously with offset/transparency |
| 17.3 | Structure comparison mode | Side-by-side or overlay with difference highlighting (displacement vectors between paired atoms) |

**Scope decisions**:
- **Multi-frame parser**: single `CrystalStructure` → `CrystalTrajectory { frames: CrystalStructure[], lattice?: 'fixed' | 'per-frame' }`. Parsers emit trajectory when multi-frame detected; single-frame wraps into 1-frame trajectory for uniformity.
- **Interpolation policy**: no inter-frame interpolation in v0.17 (frame-stepped playback only). Linear interpolation deferred — requires atom-to-atom identity mapping which is non-trivial for non-fixed cell.
- **Memory budget**: 1000 frames × N atoms × (position 12B + species 1B) = ~13 MB for N=1k; ~130 MB for N=10k. Keep raw frames in memory for N×frames ≤ 10⁷; otherwise stream from extension host via `postMessage` windowing (future: v0.17.1).
- **Bond recomputation**: off by default during playback (O(N) per frame too expensive). Provide "recompute bonds every frame" toggle with explicit cost warning.

**Open questions**:
- XDATCAR lattice handling: fixed-cell NVE vs variable-cell NPT. Default: detect "Direct configuration=" variable-lattice form and re-emit per-frame lattice.
- Extended XYZ property line (`Lattice="..." Properties=...`) parsing scope — tracked under format roadmap below.

**Exit criterion**: 1000-frame XDATCAR plays without memory leak (heap stable across 3 playback loops); scrubbing is frame-accurate.

---

## v0.18 — Editor integration

**Goal**: Deep VSCode integration for power users.

| # | Feature | Success criterion |
|---|---------|-------------------|
| 18.1 | Split-pane: text editor + 3D view | Edit CIF text, 3D view updates live (debounced reparse on save) |
| 18.2 | VSCode settings namespace (`matviz.*`) | All defaults configurable; settings UI works |
| 18.3 | Undo/redo for property changes | Ctrl+Z restores previous colors/radii/cutoffs |
| 18.4 | Marketplace publishing | Extension installable from VSCode marketplace |

**Architectural dependency — 18.1 blocker**: Current editor is `CustomReadonlyEditorProvider<CrystalDocument>`. Split-pane live edit requires migration to `CustomTextEditorProvider` (so text buffer and webview share a `TextDocument`) OR a companion text editor that posts change events into the read-only viewer. Decision gate at 18.1 kickoff — migration is ~2 days work and affects document lifecycle, dirty state, save interaction.

**Scope decisions**:
- **18.2 settings schema**: `matviz.defaults.{style,palette,showBonds,showBoundary,bondCutoff,isoLevel,cameraMode}`. Per-workspace overrides. Migration from current `localStorage` persistence schema v1 → settings-backed: localStorage wins for session, settings provide defaults.
- **18.3 undo stack**: scoped to property-panel changes (colors, radii, cutoffs, visibility). Does NOT include camera or selection. Separate stack from text-editor undo.

**Exit criterion**: Published on marketplace with all documented features working; `matviz.*` settings documented in README.

---

## Critical decision gates

1. **After 15.4 (WebGPU evaluation)** — ❌ Rejected 2026-04-18. No prototype built; decision based on cost/benefit review (GLSL-to-TSL port cost, already-optimized WebGL2 path, CLI renderer constraint). Revisit: when 50k+ structures actually bottleneck WebGL2 OR compute-shader redesign enters scope (v0.17+).
2. **Before 18.4 (marketplace publishing)** — pass criterion: all test fixtures render correctly, no console errors, README accurate. On fail: fix before publishing.

---

## Verification strategy

- **v0.14**: Manual testing at multiple editor widths (400/800/1200/2000px) across light/dark themes.
- **v0.15**: Performance benchmarks with `renderer.info` and `performance.now()` on 10k/50k atom structures. ⚠ Formal 50k measurement not yet captured — see test infrastructure.
- **v0.16**: Visual comparison with VESTA screenshots for reference structures.
- **v0.17**: Memory profiling during 1000-frame playback; leak detection via heap snapshots.
- **v0.18**: VSCode marketplace validation checklist; end-to-end install test on clean machine.

---

## Format support roadmap

Additional formats beyond the current core (CIF, POSCAR/CONTCAR/VASP, XSF/AXSF, XYZ, PDB, Cube, CHGCAR, QE, FHI-aims `geometry.in`). Not version-locked — slot opportunistically.

| Format | Scope | Notes |
|--------|-------|-------|
| LAMMPS data (`*.data`) | Atomic + charge style parse; bond/angle/dihedral sections ignored initially | Atom-types → element mapping is user-supplied (common pain point in VESTA). Consider auto-inference fallback. |
| LAMMPS dump (`*.lammpstrj`, `*.dump`) | Multi-frame trajectory | Blocked on v0.17 `CrystalTrajectory` shape. |
| GROMACS (`*.gro`) | Single-frame + residue info | Residue labels ignored for now; retain element-from-name inference. |
| Extended XYZ | `Lattice="..." Properties=...` property line | Supersedes current XYZ for ASE-produced files. |
| MOL2 / SDF | Small-molecule formats | Bond order info could feed bond-style rendering; out of scope until requested. |
| Phonopy FORCE_CONSTANTS / `band.yaml` | Phonon eigenvector arrows | Tied to v0.16.3 direction/magnitude UI. Defer until v0.16 ships. |

---

## Test infrastructure

Currently: manual inspection of `test/fixtures/`. Gaps surfaced during v0.15 review:

| Item | Why | Proposed slot |
|------|-----|---------------|
| Render snapshot regression (CLI renderer → PNG → per-pixel diff) | v0.15 impostor color drift would have been caught automatically; every rendering change is currently visually un-audited | v0.15.1 or v0.16 kickoff |
| TypeScript strict mode (`"strict": true` + targeted `noUncheckedIndexedAccess`) | Parser code has implicit-any hotspots; would have caught the XYZ numeric-element regression in tech-debt | v0.16 (bundle with parser work) |
| Bundle size budget — CI gate on `dist/webview.js` size | Three.js + shaders currently ~750 KB; impostor shaders added ~8 KB, acceptable but unchecked | any patch |
| 50k-atom performance fixture + `performance.now()` harness | v0.15 exit criterion unverified | v0.15.1 |
| Fixture coverage matrix — map parser × structure shape (anisotropic lattice, partial occupancy, moments) | v0.13.0 axis-order bug escaped 128³ cubic fixture | v0.16 |
| Headless CLI smoke test in CI | Regressions in Puppeteer/SwiftShader setup silently break the skill | any patch |

---

## Performance budget

| Metric | Target | Measurement |
|--------|--------|-------------|
| Draw calls | <100 per frame | `renderer.info.render.calls` |
| Idle GPU | 0 frames | Performance tab: no rAF activity |
| Bond detection | O(N), <200ms for 10k atoms | `performance.now()` |
| Atom picking (CPU raycaster, N<5000) | <16ms | `performance.now()` |
| Atom picking (GPU, N≥5000) | <5ms target for 50k | ⚠ unmeasured — formal harness in v0.15.1 test infrastructure |
| Isosurface 64³ | <500ms | `performance.now()` |
| Memory (no volumetric) | <100MB | DevTools heap |
| Style switch | <50ms, no bond re-detection | Visual + timing |
| 50k atoms @ 30fps rotation | v0.15 exit criterion | ⚠ unmeasured on 50k fixture; qualitatively ok at 16k |

---

## Tech-debt registry (from 2026-04-17 code review)

Tracked separately so individual items can slot into any version patch without rewriting the plan. Order is rough priority.

| Area | Item | File:line | Proposed slot |
|------|------|-----------|----------------|
| Renderer | Polyhedra with mixed-element partial occupancy — current heuristic rejects sites where the dominant ligand covers <85%; intentional, but revisit when v0.16 partial occupancy lands | `src/webview/renderer.ts` autoDetectPolyhedraCenters | v0.16 (revisit) |
| Renderer | Isosurface tile-MC memory blowup on large supercells — `tileVolumetricPBC` copies full Float32Array `na·nb·nc` times (128³ × 3×3×3 ≈ 215M voxels ≈ 860 MB). Add a guard/warning above some threshold, or fall back to mesh-tiling for small iso levels | `src/webview/marchingCubes.ts tileVolumetricPBC` | any patch / large-data tracker |
| Renderer | Iso saddle cases (MS fill cases 5 & 10) split into disjoint triangles without checking bilinear center. Fine for visualization, but topologically ambiguous for borderline saddles | `src/webview/marchingCubes.ts marchingSquaresFill` | low priority |
| Parsers | Degenerate-lattice NaN guards (γ=0/180, a=b=c=0) | `src/parsers/cifParser.ts:366`, `pdbParser.ts:66` | v0.16 (extended crystallography touches these anyway) |
| Parsers | XYZ numeric atomic-number fallback returns `'X'` — should call `getElementByNumber` like XSF | `src/parsers/xyzParser.ts:47-52` | any patch |
| Parsers | Auto-detect CIF via `content.includes('_cell_length_a')` — naive, gated only by prior filename checks | `src/parsers/index.ts:61` | low; keep noted |
| Shared | Duplicate `BOHR_TO_ANG` constant | `src/parsers/cubeParser.ts:4`, `qeParser.ts:3` | trivial cleanup |
| Renderer | Impostor vs Phong tone/sRGB mismatch — impostor path brighter | `src/webview/renderer.ts` sphere/cylinder impostor frag shaders | v0.15.1 (dedicated) |
| Renderer | `AtomPickingRenderer` render-target lifecycle — NOT disposed in `disposeResources()` because that runs on every `rebuild()`; lives for `CrystalRenderer` lifetime. Needs a separate terminal-dispose hook | `src/webview/picking.ts`, `renderer.ts` dispose path | v0.15.1 or v0.16 cleanup |
| Renderer | `CylinderImpostorMesh.raycast` is a no-op — bond picking unavailable with cylinder impostors on | `src/webview/bondRenderer.ts` (impostor path) | v0.16+ (when bond picking is requested) |

**Resolved since the registry was opened** (audit trail):
- QE parser silent 10×10×10 default → throws on empty parse. Shipped v0.13.1 (`qeParser.ts:85–90`).
- Axis label `CanvasTexture` texture leak → component extracted to `AxisIndicator` with `textures.push(tex)` discipline. Shipped v0.14.0 (`src/webview/axisIndicator.ts:78`).
- `index.ts` dead aims branch → refactored so `.out/.pw/.stdout/.stdin` dispatches to QE in a separate block from `.in` → FHI-aims. No more overlap.
- `renderer.ts` split — `BondRenderer` extraction. Shipped v0.15.0 (`src/webview/bondRenderer.ts`). `MaterialRegistry` still inline via `trackMat` — adequate, not module-extracted.
- Redundant negative-iso branch collapsed into single `addLobe` helper. Shipped in commit `e495ba0` as part of the iso supercell rewrite.
- Polyhedra hand-rolled convex hull producing phantom diagonal triangles (algorithmic, not from the registry but recurring user complaint) → replaced with `ConvexGeometry`. Shipped in commit `1d1ea8a`.
- Isosurface "doesn't work in supercell" + missing boundary caps + 1/Nx-gap at cell boundary → tiled-data single-MC + marching-squares caps + `pbc` flag. Shipped in commit `e495ba0`.

---

## Known-solid (verified during 2026-04-17 review — leave alone)

- Marching cubes (`webview/marchingCubes.ts`) — interpolation, winding, normal generation correct.
- XSF/CHGCAR Fortran→C reorder fix from v0.13.0 — verified against `marchingCubes.ts:29` indexing.
- Boundary-atom wrap into [0,1) + supercell expansion — dedup logic and edge handling sound.
- InstancedMesh discipline — `updateMatrix()` before `setMatrixAt()`, `instanceMatrix.needsUpdate = true`.
- Canvas sizing — `renderer.setSize(w, h, false)` preserves CSS layout (locked decision upheld).
- Extension-host surface — CSP nonce per-panel, `localResourceRoots` locked to `dist`/`media`, `asWebviewUri` throughout; export uses native `showSaveDialog` (no path traversal); webview inbound messages restricted to `ready`/`openAsText`.
- `scripts/install-skill.sh` — properly hardened (`set -euo pipefail`, quoted expansions).
