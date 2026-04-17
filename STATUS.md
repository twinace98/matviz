# Project Status

- **Version**: v0.15.0 (released 2026-04-18) — Advanced rendering: sphere + cylinder impostors, hybrid GPU picking (N≥5000), chunked InstancedMesh frustum culling, BondRenderer extraction. Angle/dihedral measurements now draw dashed lines.
- **Phase**: v0.15 closed. v0.16 (extended crystallography) next.
- **People**: Seungwoo Shin (twinace98)
- **Repo**: https://github.com/twinace98/matviz.git

## How to resume next session

1. Read in order: `CLAUDE.md` (architecture + workflow) → `Plan.md` (roadmap) → this file → active `plans/` pair if any.
2. Auto-memory loads from `~/.claude/projects/-home-swshin-matviz/memory/`.
3. **Next action**: v0.16 kickoff — thermal ellipsoids, partial occupancy, magnetic moment vectors. Before that: address v0.15 known issue — impostor rendering is visibly brighter than Phong path (shader tone/sRGB mapping mismatch); diagnose and fix as a v0.15.1 or fold into v0.16 kickoff.

## Completed

- **v0.1** (2026-04-15): Initial CIF/POSCAR/XSF viewer with ball-and-stick rendering
- **v0.2–v0.10** (2026-04-15): Full feature set — performance, camera, bonds, polyhedra, selection, symmetry, volumetric, properties, export
- **v0.11** (2026-04-15): UI overhaul — dark/light palette toggle, rotation sensitivity fix, clipping fix for large supercells
- **v0.12** (2026-04-16): Rendering fixes, license cleanup, boundary wrap logic, stick style fix, bond defaults (`rA+rB+0.3`), adaptive top-bar, collapsible side panel, canvas sizing fix
- **v0.13** (2026-04-16): Headless CLI renderer (`scripts/render.ts` → `dist/render.js`) via Puppeteer + SwiftShader; Claude skill `matviz-render`; XSF/CHGCAR isosurface axis-order hotfix (Fortran→C layout at parse time)
- **v0.14.0** (2026-04-17): UX polish — sidebar layout modes (offset default, overlay preserved), responsive toolbar via CSS container queries, keyboard shortcut modal on `?`, bond-detection skip hint with "Compute anyway" for >5 000-atom structures, persisted state schema v1 (layout/panel/steps/visibility/element + bond overrides/iso/axis size), AxisIndicator component extracted to `src/webview/axisIndicator.ts`, 16 000-atom diamond stress fixture
- **v0.15.0** (2026-04-18): Advanced rendering — BondRenderer module extracted from renderer.ts; sphere impostor (billboard quad + ray-sphere in fragment, gl_FragDepth); cylinder impostor for bonds (bicolor split at midpoint, ray-cylinder intersection); chunked InstancedMesh frustum culling (spatial binning per element); hybrid GPU picking (1×1 render target with camera.setViewOffset, N≥5000 threshold, CPU raycaster below); angle/dihedral measurements now draw yellow/cyan/magenta dashed outlines. WebGPU backend evaluation rejected (cost/benefit — revisit when compute-shader redesign enters scope). **Known issue**: impostor render appears slightly brighter/more saturated than Phong path; tracked for v0.15.1 or folded into v0.16 kickoff.
- **v0.13.1** (2026-04-17): Hardening release — single-source element data (`src/shared/elements-data.ts`, 80 elements w/ lanthanide displayRadius fill), editor parse-error boundary with "Open as Text" fallback, ambiguous `.in/.out/.stdin/.stdout/.pw` editor priority lowered to `"option"` + title-bar "Open in MatViz" button, QE parser throws on empty parse instead of returning 10×10×10 default, renderer material registry disposes all inline `MeshPhong/MeshBasic/Line/Sprite` allocations, CLI renderer `try/finally` around browser lifecycle, webview CSP dropped `'unsafe-inline'` (inline styles → utility classes)

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

## Open questions

- Proportional UI scaling — decided against for now; using flex-wrap + collapsible panel instead. Revisit if users request.
- Side panel overlaying canvas vs. dedicated layout — currently overlay with toggle; option 1 (canvas offset) deferred.
