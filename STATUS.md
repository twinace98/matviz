# Project Status

- **Version**: v0.17.4 (CLI parity patch — `--phase` + `--compare-to-phase`) shipped 2026-04-26. Closes the CLI/webview feature-parity gap for multi-phase overlay and comparison. Earlier bundled release v0.17.3 (v0.16 + v0.17 + v0.17.1 + v0.17.2 + v0.17.3) shipped 2026-04-23.
- **Phase**: v0.18.0 (Floating UI / V2 redesign) **kickoff approved 2026-04-26**, on hold while v0.17.4 was inserted. Plan + impl spec already drafted in `plans/v0.18.0_floating-ui*.md` (uncommitted). Feature 18.1 (groundwork — unified SVG icons + step-angle/zoom stepper) code complete and quality-gate-clean, pre-commit (modifications in `media/styles.css`, `src/editor/crystalEditorProvider.ts`, `src/webview/main.ts`). v0.18 reroutes the v0.18 slot from "Editor integration" → "Floating UI"; the editor-integration backlog shifts to v0.19.
- **People**: Seungwoo Shin (twinace98)
- **Repo**: https://github.com/twinace98/matviz.git (also pushes to `sogang-qmp` remote)

## How to resume next session

1. Read in order: `CLAUDE.md` (architecture + workflow) → `Plan.md` (roadmap) → this file → active `plans/` pair if any.
2. Auto-memory loads from `~/.claude/projects/-home-swshin-matviz/memory/`.
3. **Next action** (in priority order):
   1. Commit v0.18.0 kickoff (Plan.md + STATUS.md + plans/v0.18.0_floating-ui*.md) as `chore(v0.18.0): kick off plan + impl spec for Floating UI (V2 redesign)`.
   2. Commit Feature 18.1 (already pre-staged in working tree: ICON object, step-angle/zoom stepper, palette innerHTML swap in `media/styles.css` + `src/editor/crystalEditorProvider.ts` + `src/webview/main.ts`) as `feat(v0.18.0.1): unified SVG icons + step-angle/zoom stepper (V2 groundwork)`.
   3. Begin Feature 18.2 (V2 design tokens in `media/styles.css`) per `plans/v0.18.0_floating-ui_impl.md`.
   4. v0.17.x backlog (CLI polish — see Plan.md "v0.17.x backlog") is to-do but does not block v0.18.

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

## Hotfixes

- **2026-04-16 — XSF/CHGCAR isosurface axis order** (shipped in v0.13.0): Fortran→C layout reorder at parse time.
- **2026-04-23 — magmom arrow black render** (commit `0c23a2c`, in v0.17.3 bundle): `vertexColors:true` removed from magnetic arrow material; instanceColor multiplies cleanly.

## Pending (from Plan.md)

- [ ] **v0.18** — Floating UI / V2 redesign (8 sub-features 18.1–18.8). Plan pair drafted (`plans/v0.18.0_floating-ui*.md`), not yet committed. Kickoff approved 2026-04-26; resumed after v0.17.4 release.
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
