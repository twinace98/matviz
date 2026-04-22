# Project Status

- **Version**: v0.15.0 installed locally with two unreleased fix commits on `main` (polyhedra overhaul 2026-04-21, isosurface supercell+caps+PBC 2026-04-22). No version bump yet — user hasn't approved cutting a patch release.
- **Phase**: v0.15 closed. Two fix commits pending a version decision (v0.15.2) before v0.16 starts.
- **People**: Seungwoo Shin (twinace98)
- **Repo**: https://github.com/twinace98/matviz.git (also pushes to `sogang-qmp` remote)

## How to resume next session

1. Read in order: `CLAUDE.md` (architecture + workflow) → `Plan.md` (roadmap) → this file → active `plans/` pair if any.
2. Auto-memory loads from `~/.claude/projects/-home-swshin-matviz/memory/`.
3. **Next action** (in priority order):
   1. Decide version for the two pending fix commits — cut **v0.15.2 "polyhedra + iso polish"** vs. bundle into v0.15.1 (impostor color polish) vs. fold into v0.16 kickoff. See commits `1d1ea8a` (polyhedra) and `e495ba0` (iso supercell+caps).
   2. Address remaining v0.15 known issue — impostor rendering brighter than Phong path (tone/sRGB mismatch). v0.15.1 plan in `Plan.md` describes the visual-regression harness approach.
   3. After v0.15.x settles, v0.16 kickoff — thermal ellipsoids, partial occupancy, magnetic moment vectors.

## Completed

- **v0.1** (2026-04-15): Initial CIF/POSCAR/XSF viewer with ball-and-stick rendering
- **v0.2–v0.10** (2026-04-15): Full feature set — performance, camera, bonds, polyhedra, selection, symmetry, volumetric, properties, export
- **v0.11** (2026-04-15): UI overhaul — dark/light palette toggle, rotation sensitivity fix, clipping fix for large supercells
- **v0.12** (2026-04-16): Rendering fixes, license cleanup, boundary wrap logic, stick style fix, bond defaults (`rA+rB+0.3`), adaptive top-bar, collapsible side panel, canvas sizing fix
- **v0.13** (2026-04-16): Headless CLI renderer (`scripts/render.ts` → `dist/render.js`) via Puppeteer + SwiftShader; Claude skill `matviz-render`; XSF/CHGCAR isosurface axis-order hotfix (Fortran→C layout at parse time)
- **v0.14.0** (2026-04-17): UX polish — sidebar layout modes (offset default, overlay preserved), responsive toolbar via CSS container queries, keyboard shortcut modal on `?`, bond-detection skip hint with "Compute anyway" for >5 000-atom structures, persisted state schema v1 (layout/panel/steps/visibility/element + bond overrides/iso/axis size), AxisIndicator component extracted to `src/webview/axisIndicator.ts`, 16 000-atom diamond stress fixture
- **v0.15.0** (2026-04-18): Advanced rendering — BondRenderer module extracted from renderer.ts; sphere impostor (billboard quad + ray-sphere in fragment, gl_FragDepth); cylinder impostor for bonds (bicolor split at midpoint, ray-cylinder intersection); chunked InstancedMesh frustum culling (spatial binning per element); hybrid GPU picking (1×1 render target with camera.setViewOffset, N≥5000 threshold, CPU raycaster below); angle/dihedral measurements now draw yellow/cyan/magenta dashed outlines. WebGPU backend evaluation rejected (cost/benefit — revisit when compute-shader redesign enters scope). **Known issue**: impostor render appears slightly brighter/more saturated than Phong path; tracked for v0.15.1 or folded into v0.16 kickoff.
- **v0.13.1** (2026-04-17): Hardening release — single-source element data (`src/shared/elements-data.ts`, 80 elements w/ lanthanide displayRadius fill), editor parse-error boundary with "Open as Text" fallback, ambiguous `.in/.out/.stdin/.stdout/.pw` editor priority lowered to `"option"` + title-bar "Open in MatViz" button, QE parser throws on empty parse instead of returning 10×10×10 default, renderer material registry disposes all inline `MeshPhong/MeshBasic/Line/Sprite` allocations, CLI renderer `try/finally` around browser lifecycle, webview CSP dropped `'unsafe-inline'` (inline styles → utility classes)

## Unreleased fixes on `main` (post-v0.15.0)

- **2026-04-21 — Polyhedra overhaul** (`1d1ea8a`): replaced hand-rolled convex hull (which produced spurious diagonal triangles inside octahedra) with `three/examples/jsm/geometries/ConvexGeometry`; added per-element polyhedra-center selection (side-panel checkbox list) with auto-detect via first-coordination-shell + aggregated-ligand-purity heuristic (keeps TiO6, drops A-site 12-coord and bridging O in perovskites); `showPolyhedra` intentionally NOT restored from saved state so matviz always opens with polyhedra off; CLI `--polyhedra-centers Ti,Fe` flag.
- **2026-04-22 — Isosurface supercell + caps + PBC** (`e495ba0`): isosurface now tiles volumetric data PBC across the supercell (data tiled to `[Nx*na, Ny*nb, Nz*nc]`, MC runs once on the full grid — inner cell boundaries seamless); 6 outer supercell faces get capped via 2D marching-squares fill (new `marchingSquaresFill` helper, 16-case lookup, saddle cases split); `marchingCubes` gains a `pbc` flag so iso reaches the exact cell boundary instead of stopping one voxel short; `buildVisuals` now rebuilds iso so supercell changes propagate. Also fixed an axis-order bug in the b-face cap setup (slice layout vs dims were transposed — same spirit as the v0.13.0 Fortran→C bug).

## Hotfixes

- **2026-04-16 — XSF/CHGCAR isosurface axis order** (shipped in v0.13.0): XSF and CHGCAR store volumetric data in Fortran order (ix fastest); `marchingCubes` indexes in C order. The mismatch permuted axes and was invisible for the cubic 128³ test fixture but produced wrong isosurfaces on anisotropic grids (e.g. 49×49×673 slab PARCHG). Fixed in `xsfParser.ts` and `chgcarParser.ts` by reordering into C layout at parse time. Cube parser was already correct. Log: `working/hotfix_xsf-chgcar-iso-axis.md`.

## Pending (from Plan.md)

- [ ] **v0.15** — Advanced rendering (sphere impostors, WebGPU, etc.)
- [ ] **v0.16** — Extended crystallography (thermal ellipsoids, partial occupancy, magnetic moments)
- [ ] **v0.17** — Animation & multi-structure (MD trajectory, multi-phase overlay)
- [ ] **v0.18** — Editor integration (split-pane, VSCode settings namespace, undo/redo)

## Decisions locked in

- **Bond defaults** (locked 2026-04-16 from v0.12): `min: 0.1, max: (rA+rB)+0.3` — adjusted from earlier `min: 0.4, max: (rA+rB)*1.2`.
- **Boundary default on** (locked 2026-04-16 from v0.12): `showBoundaryAtoms = true` with fractional wrap into [0,1).
- **Canvas sizing** (locked 2026-04-16 from v0.12): CSS `width/height: 100%` drives layout; `renderer.setSize(w, h, false)` preserves it.
- **Polyhedra off on file init** (locked 2026-04-21): `showPolyhedra` explicitly NOT restored from saved state so each file-open starts with polyhedra off. User opts in per session. `polyhedraCenters` auto-detect runs on each structure load.
- **Polyhedra auto-detect heuristic** (locked 2026-04-21): element qualifies as a center iff (a) max first-shell coord ∈ [4, 8] using nearest *heteroatomic* distance × 1.2, AND (b) aggregated dominant ligand ≠ E covers ≥ 85% of first-shell neighbors across all atoms of E. Rejects 12-coord A-sites, bridging anions (O in ABO3), and homoatomic metallic coordination.
- **Isosurface supercell = PBC tile + single MC + outer caps** (locked 2026-04-22, rejected "tile meshes" alternative): option 2 from the day's discussion — data tiled PBC to supercell dims, one MC pass, caps only on outer 6 faces. Works seamlessly for periodic DFT data (CHGCAR/XSF); non-periodic toy cube files show expected seam artifacts (acceptable).

## Open questions

- Proportional UI scaling — decided against for now; using flex-wrap + collapsible panel instead. Revisit if users request.
- Side panel overlaying canvas vs. dedicated layout — currently overlay with toggle; option 1 (canvas offset) deferred.
