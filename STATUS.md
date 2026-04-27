# Project Status

- **Version**: v0.18.1 (polish + parser breadth patch) shipped 2026-04-27 on top of v0.18.0. Adds light-theme support for V2 chrome (rail/panel/toolbar/pill/HUD inverts on `vscode-light`), generalizes "Magnetic moments" → kind-aware "Vectors" overlay (auto-detects from POSCAR MAGMOM, XSF trailing cols, extended-XYZ Properties, CIF moments), full QE `ibrav` coverage (0..14 + signed variants, both `celldm(1..6)` and `A,B,C,cosAB,cosAC,cosBC` forms), Measure-HUD polish (no number gradient + element-colored atom symbols), and side-panel-aware viewport shift via `Camera.setViewOffset` (canvas stays full-size; only the rendered scene moves). Earlier v0.18.0 shipped 2026-04-26 (Floating UI / V2 redesign).
- **Phase**: v0.18 closed (0.18.1 patch). v0.19 inherits the editor-integration backlog (split-pane, settings namespace, undo/redo) per Plan.md. Marketplace publishing is deferred to a post-v0.21 milestone.
- **People**: Seungwoo Shin (twinace98)
- **Repo**: https://github.com/twinace98/matviz.git (also pushes to `sogang-qmp` remote)

## How to resume next session

1. Read in order: `CLAUDE.md` (architecture + workflow) → `Plan.md` (roadmap) → this file → active `plans/` pair if any.
2. Auto-memory loads from `~/.claude/projects/-home-swshin-matviz/memory/`.
3. **Next action** (in priority order):
   1. v0.19 kickoff — editor integration (split-pane, settings namespace, undo/redo) per Plan.md. Architectural decision gate: migrate to `CustomTextEditorProvider` vs. companion text editor.
   2. v0.20 kickoff — symmetry detection via spglib WASM (Plan.md). Decision gate at 20.1: emscripten build vs. Rust `moyo` vs. existing npm wrapper. Synergy with v0.21 (web SPA shares the WASM artifact).
   3. v0.21 kickoff — Web SPA on github.io (Plan.md). Decision gate at 21.1: esbuild vs. Vite for the SPA bundler. Builds on the v0.20 WASM symmetry artifact and the existing parser modules.
   4. v0.17.x / v0.18.x CLI + UI polish backlog — see Plan.md. Non-blocking for v0.19/v0.20/v0.21.
   5. **Deferred**: Marketplace publish — post-v0.21 milestone, separate from any version. Gated on a fresh wordmark/icon raster pass since vsce strict-bans SVGs in README.

## Completed

- **v0.1** (2026-04-15): Initial CIF/POSCAR/XSF viewer with ball-and-stick rendering
- **v0.2–v0.10** (2026-04-15): Full feature set — performance, camera, bonds, polyhedra, selection, symmetry, volumetric, properties, export
- **v0.11** (2026-04-15): UI overhaul — dark/light palette toggle, rotation sensitivity fix, clipping fix for large supercells
- **v0.12** (2026-04-16): Rendering fixes, license cleanup, boundary wrap logic, stick style fix, bond defaults (`rA+rB+0.3`), adaptive top-bar, collapsible side panel, canvas sizing fix
- **v0.13** (2026-04-16): Headless CLI renderer (`scripts/render.ts` → `dist/render.js`) via Puppeteer + SwiftShader; Claude skill `matviz-render`; XSF/CHGCAR isosurface axis-order hotfix (Fortran→C layout at parse time)
- **v0.13.1** (2026-04-17): Hardening pass (shared element data, CSP tightening, error boundary)
- **v0.14.0** (2026-04-17): UX polish — sidebar layout modes, responsive toolbar, keyboard shortcut modal, bond skip hint, persisted state schema v1, AxisIndicator extraction, 16k-atom stress fixture
- **v0.15.0** (2026-04-18): Advanced rendering — sphere/cylinder impostors, GPU picking, frustum culling
- **v0.15.2** (2026-04-22): Polyhedra ConvexGeometry overhaul + iso supercell tiling/caps/PBC marching cubes
- **v0.16.0~16.5** (2026-04-22): Extended crystallography — visual-regression harness (16.0); CIF aniso parser + multi-loop refactor + NaN guards + Jacobi eigen + ellipsoid InstancedMesh + side-panel UI (16.1); partial occupancy via stacked transparent (16.2); magnetic moment vectors (POSCAR MAGMOM + CIF moment) + arrow renderer + UI (16.3); Wulff construction via triple-plane intersection (16.4); TS strict + fixture coverage matrix (16.5); plus magmom black-arrow fix and 4 CLI ports (16.1~16.4 exposed in headless renderer).
- **v0.17.0** (2026-04-23): Animation & multi-structure — `CrystalTrajectory` data contract + parser bridge + webview message + renderer hook (17.1.0); AXSF (multi-frame XSF) parser (17.1.1); XDATCAR parser NVE+NPT (17.1.2); extended XYZ ASE format parser (17.1.3); playback UI + rAF loop (17.1.4); bond recompute toggle + perf guard (17.1.5); multi-phase overlay (17.2). 17.3 (comparison mode) pre-split to v0.17.1.
- **v0.17.1** (2026-04-23): Comparison mode — NN atom matching algorithm + unit tests (17.3.0); displacement arrow renderer (Viridis colormap) + comparison UI + frame-aware auto-recompute (17.3.1).
- **v0.17.2** (2026-04-23): UX + correctness patch — unified Phases+Comparison side-panel UI + playback UX polish (Space, speed slider, frame input, once-only loop) + vscode toast (17.2.1); PBC-aware NN matching (minimum-image distance) (17.2.2); RMSD/displacement summary panel (17.2.3).
- **v0.17.3** (2026-04-23): Trajectory CLI — `--frame N` for single-frame extraction with content-based XDATCAR/AXSF auto-detect (17.3.1); `--all-frames` for PNG sequence rendering with browser reuse (17.3.2). Enables matviz-render skill MD-trajectory animation workflow via ffmpeg.
- **v0.17.4** (2026-04-26): Phase + comparison CLI — `--phase <file>` repeatable transparent overlay (17.4.1); `--compare-to-phase` NN displacement arrows + Viridis colormap + single-line `[comparison] RMSD: …` stdout summary, PBC-aware on identical lattices (17.4.2). Closes CLI/webview parity for multi-phase + comparison features.
- **v0.18.0** (2026-04-26): Floating UI / V2 redesign — V2 design tokens (glass / surface / line / shadow / type scale) (18.2); full-height glass mode rail (18.3); centered floating glass toolbar (18.4); detached floating glass side panel + offset/overlay toggle removed (18.5); style chips replacing the display-style `<select>`, toggle switches in VSCode focus blue, V2 supercell `− N +` stepper with upper bound removed, canonical bottom-left info pill, axis gizmo bottom-right (18.6); 4-column help overlay redesign + global digit shortcuts 1–4 → display style (18.7); top-right Measure HUD overlay with hero distance/angle/dihedral, atom-pair card, Δ fractional + cartesian rows, and a clipboard copy button (18.8). Groundwork commit (18.1) introduced the unified inline-SVG icon set (24 glyphs replacing Unicode/emoji) and the full-height ▲/▼ numeric stepper for step-angle / step-zoom (`type="text"` + `inputmode="numeric"` to bypass native browser spinners). All 8 features landed as separate `feat(v0.18.0.N)` commits behind a single `chore(v0.18.0)` kickoff.

## Hotfixes

- **2026-04-16 — XSF/CHGCAR isosurface axis order** (shipped in v0.13.0): Fortran→C layout reorder at parse time.
- **2026-04-23 — magmom arrow black render** (commit `0c23a2c`, in v0.17.3 bundle): `vertexColors:true` removed from magnetic arrow material; instanceColor multiplies cleanly.

## Pending (from Plan.md)

- [x] **v0.18** — Floating UI / V2 redesign (8 sub-features 18.1–18.8). Shipped 2026-04-26. Plan pair archived to `plans/archives/`.
- [ ] **v0.19** — Editor integration (split-pane, VSCode settings namespace, undo/redo). Inherited from old v0.18 placeholder. Marketplace publishing pulled out into a separate deferred milestone.
- [ ] **v0.17.x backlog** (CLI polish): per-phase opacity/offset, trajectory phase frame selection, per-phase tint, `--compare-trajectory`, `--stats-out` JSON, per-pair displacement listing. To-do but non-blocking.

## Decisions locked in

- **Bond defaults** (locked 2026-04-16 from v0.12): `min: 0.1, max: (rA+rB)+0.3`.
- **Boundary default on** (locked 2026-04-16 from v0.12): `showBoundaryAtoms = true` with fractional wrap into [0,1).
- **Canvas sizing** (locked 2026-04-16 from v0.12): CSS `width/height: 100%` drives layout; `renderer.setSize(w, h, false)` preserves it.
- **Polyhedra off on file init** (locked 2026-04-21): `showPolyhedra` not restored from saved state.
- **Polyhedra auto-detect heuristic** (locked 2026-04-21): first-coordination-shell heteroatomic + aggregated dominant ligand ≥ 85%.
- **Isosurface supercell = PBC tile + single MC + outer caps** (locked 2026-04-22): option 2 from the day's discussion.
- **CrystalTrajectory wrapper + dual parser API** (locked 2026-04-23 v0.17.1.0): `parseStructureFile` (single-frame, all existing call sites) + `parseStructureFileTraj` (trajectory-aware, new entry). Length-1 trajectory wraps single-frame for uniform downstream code.
- **Bond recompute default off in trajectory playback** (locked 2026-04-23 v0.17.1.5): inherit frame-0 bonds across frames; toggle for opt-in per-frame recomputation; auto-disable above 5k atoms.
- **PBC-aware NN matching when same lattice REF** (locked 2026-04-23 v0.17.2.2): minimum-image distance via fractional round; raw cartesian when cells differ.
- **Bundled v0.16+v0.17+v0.17.1+v0.17.2+v0.17.3 release** (locked 2026-04-23): single jump 0.15.2 → 0.17.3 with one tag (option A).
- **v0.17.4 inserted ahead of v0.18** (locked 2026-04-26): user requested CLI parity patch land before resuming Floating UI work. v0.17.4 → standalone release (not bundled into v0.18) so the CLI parity feature is consumable independently.
- **First-`--phase`-only for `--compare-to-phase`** (locked 2026-04-26 v0.17.4.2): with multiple `--phase` files, only the first participates in comparison. Others remain visualization-only overlays.
- **`--compare-to-phase` rejects `--all-frames`** (locked 2026-04-26 v0.17.4.2): per-frame trajectory comparison semantics ambiguous; deferred to a future `--compare-trajectory` flag.

## Open questions

- (none currently — v0.17.4 vs v0.18 ordering question resolved in favor of v0.17.4-first; v0.18 work resumes from pre-staged Feature 18.1 in working tree.)
