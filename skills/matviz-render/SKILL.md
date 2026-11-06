---
name: matviz-render
description: >
  Render crystal structure files (CIF, POSCAR, XSF, XYZ, PDB, Gaussian Cube, CHGCAR,
  Quantum ESPRESSO output, FHI-aims geometry.in) to PNG images via a headless CLI.
  Supports ball-and-stick, space-filling, stick, and wireframe styles; orthographic
  or perspective camera; axis-aligned views (a/b/c/a*/b*/c*/std), arbitrary (hkl) plane-normal views, or [uvw] direct-lattice direction views; supercell expansion;
  boundary atoms; bond detection; coordination polyhedra; element labels; isosurface
  (volumetric data); lattice planes; dark/light palettes.
  Trigger on: "구조 시각화해줘", "이 POSCAR/CIF 그려줘", "원자 구조 이미지로 뽑아줘",
  "보고서에 구조 이미지 넣어줘", "render this structure", "visualize crystal structure",
  "screenshot of the structure", "convert structure to PNG", or any request to
  produce a static image of a material structure from its coordinate file.
---

# matviz-render — CLI Crystal Structure Renderer

Produces PNG images of crystal structures using the matviz headless renderer
(`{{MATVIZ_DIR}}/dist/render.js`). This is the non-GUI sibling of the matviz
VSCode extension — same parsers, same rendering model, no mouse needed.

## When to use

- Generating structure figures for reports, papers, or slides from a calculation's
  input/output geometry files.
- Producing before/after comparison images during a structural optimization.
- Checking that a parsed structure looks correct without opening VSCode.
- Embedding structure previews alongside calculation results (labscribe-style reports).

## Quick start

```bash
# Basic: default ball-and-stick, standard orientation
node {{MATVIZ_DIR}}/dist/render.js path/to/structure.cif -o structure.png

# With options
node {{MATVIZ_DIR}}/dist/render.js POSCAR \
  -o perovskite.png \
  --supercell 2,2,2 \
  --view c \
  --style ball-and-stick \
  --width 1600 --height 1200
```

After rendering, **always `Read` the PNG** to verify the output is what the user expected
before reporting completion. Silent success is not success.

## Options reference

| Flag | Values | Default | Purpose |
|------|--------|---------|---------|
| `-o, --output` | path | `{input_stem}.png` | Output PNG path |
| `--width` | pixels | 1920 | Image width |
| `--height` | pixels | 1080 | Image height |
| `--style` | `ball-and-stick`\|`space-filling`\|`stick`\|`wireframe` | `ball-and-stick` | Rendering mode |
| `--camera` | `ortho`\|`persp` | `ortho` | Projection |
| `--view` | `a`\|`b`\|`c`\|`a*`\|`b*`\|`c*`\|`std`\|`h,k,l`\|`[u,v,w]` | `std` | Camera direction. `h,k,l` = (hkl) plane normal (reciprocal), e.g. `--view 1,1,0` for the (110) view. `[u,v,w]` = direct-lattice direction, e.g. `--view '[1,1,0]'` to look along `a+b` (quote the brackets in shell) |
| `--rotate` | `x,y,z` (deg) | `0,0,0` | Extra rotation applied after view |
| `--supercell` | `na,nb,nc` | `1,1,1` | Repeat unit cell |
| `--palette` | `dark`\|`light` | `dark` | Color palette (dark = brightened CPK) |
| `--bg` | hex or `transparent` | `#1e1e1e` | Background color |
| `--no-bonds` | flag | bonds on | Hide bonds |
| `--no-boundary` | flag | boundary on | Hide periodic-image atoms at cell edges |
| `--no-cell` | flag | cell on | Hide unit-cell wireframe |
| `--labels` | flag | off | Show element labels on atoms |
| `--polyhedra` | flag | off | Show coordination polyhedra (auto-detects cation-like elements with max coordination 4–8) |
| `--polyhedra-centers` | `El1,El2,…` | auto | Comma-separated elements used as polyhedra centers (e.g. `Ti,Fe`). Implies `--polyhedra`. |
| `--iso` | number | off | Isosurface level (for Cube/CHGCAR/XSF with volumetric data) |
| `--grid` | name | first | Select a named grid when the file has several: **CHGCAR spin** → `charge`, `magnetization`, `spin_up`, `spin_down` (collinear) or `magnetization_x`/`_y`/`_z` (SOC); **XSF multi-datagrid** → the datagrid label. Unknown names print the available list to stderr and fall back to the first grid. |
| `--plane` | `h,k,l` | off | Add lattice plane |
| `--vectors` | flag | off | Render per-atom vector arrows. Auto-detected from POSCAR `MAGMOM`, XSF trailing columns (cols 5–7), extended-XYZ `Properties=` (`magmom`/`forces`/`velocities`/`displacements`), CIF `_atom_site_moment_*`. Aliased as `--magmom` for backward-compat. |
| `--vector-colormap` | `redblue`\|`viridis` | `redblue` | Arrow color: `redblue` = sign-coded by v_z (FM/AFM intuition); `viridis` = sequential by \|v\|. Alias: `--magmom-colormap`. |
| `--vector-scale` | number | `1.0` | Arrow length (Å per unit-magnitude vector). Alias: `--magmom-scale`. |
| `--partial-occupancy` | flag | off | Render sites with `_atom_site_occupancy` < 1 as transparent atoms (opacity = occupancy). Default off shows the dominant species opaque. |
| `--ellipsoids` | flag | off | Render thermal ellipsoids for atoms with anisotropic U (CIF `_atom_site_aniso_U_*`). Phong-only path. |
| `--ellipsoid-contour` | `0.5`\|`0.9` | `0.5` | Probability contour level. Implies `--ellipsoids`. |
| `--wulff` | `"h,k,l,γ; …"` | off | Render Wulff polytope from semicolon-separated (h,k,l,γ) tuples. γ = relative surface energy per face. |
| `--frame` | `N` (0-indexed) | `0` | Trajectory file (XDATCAR / AXSF / extended XYZ): render the Nth frame. Out-of-range clamps with warn. Ignored for single-frame files. |
| `--all-frames` | flag | off | Render every trajectory frame as a PNG sequence: `<output>_NNNN.png` (1-indexed, 4-digit zero-padded; auto-expands beyond 9999 frames). Conflicts with `--frame` (all wins + warn). |
| `--phase` | `<file>` | — | Add a secondary structure as a transparent overlay (default offset (0,0,0), opacity 0.5). Repeatable: `--phase a.cif --phase b.cif` accumulates. Single-frame parse (first frame for trajectory phase files). |
| `--compare-to-phase` | flag | off | Compute NN displacement from the primary structure to the **first** `--phase`, render Viridis-coloured arrows, and print a one-line `[comparison] RMSD: X.XXX Å (matched N, unmatched M, max …, mean …, p95 …)` summary to stdout. Same-species NN matching; PBC-aware when the two lattices are equal. Requires `--phase`; incompatible with `--all-frames`. |
| `--info` | flag | off | Print a structure summary (atoms, formula, cell parameters, volume, space group, crystal system, Hall number) to stdout. If `-o` is omitted, exits without spinning up the headless browser — ideal for fast info-only queries. Combine with `-o` to render PNG **and** print info. |
| `--json` | flag | off | Emit `--info` output as JSON instead of plain text. Implies `--info`. Easier to consume from report-generation pipelines (`jq`, Python, etc.). |
| `--max-grid-points` | number or `full` | `2e7` | Per-grid point budget for volumetric files. Larger grids are downsampled while the file streams in (periodic trilinear — no position drift), e.g. 600³ → 200³. `full` = only the 4×10⁸ memory-safety cap. `--info` shows the file's grid and the factor that will be used. |
| `--timeout` | seconds | `30` | Time allowed for page load + scene build. Raise for large supercells or dense volumetric grids (`Navigation timeout of … ms exceeded`). |
| `--test` | flag | — | Render a test scene (red sphere) for smoke-testing |
| `-h, --help` | flag | — | Print usage |

## Common recipes

**Report figure — clean presentation view of a unit cell**
```bash
node {{MATVIZ_DIR}}/dist/render.js nacl.cif \
  -o fig_nacl.png --view std --width 1600 --height 1200 --bg white --palette light
```

**Large supercell for visual inspection**
```bash
node {{MATVIZ_DIR}}/dist/render.js CONTCAR \
  -o relaxed.png --supercell 3,3,3 --style ball-and-stick
```

**Space-filling view along c-axis**
```bash
node {{MATVIZ_DIR}}/dist/render.js structure.poscar \
  -o sf_top.png --style space-filling --view c --no-cell
```

**Charge density isosurface from CHGCAR / Cube / XSF**
```bash
node {{MATVIZ_DIR}}/dist/render.js h2o.cube \
  -o chg.png --iso 0.05 --view a*
```
Tip: iso level depends on the data's value range. Start at ~0.05 for typical
charge densities, then bracket up/down. Both positive and negative lobes are
rendered (blue / red, VESTA convention) when the data is signed.

**Very large volumetric files (hundreds of MB to tens of GB)**
```bash
# 1) Inspect first — reads only the header, instant on any size:
node {{MATVIZ_DIR}}/dist/render.js wfn.cube --info
#   Grid: 1200×1200×1200, 1 grid, 6.44 GiB at full resolution
#   Render grid: 270×270×270 (factor 5, …; --max-grid-points 20000000)
# 2) Render — the file is streamed and downsampled on the fly:
node {{MATVIZ_DIR}}/dist/render.js wfn.cube -o wfn.png --iso 0.01
# Finer grid (slower), or the full grid if it fits in memory:
node {{MATVIZ_DIR}}/dist/render.js wfn.cube -o wfn.png --iso 0.01 --max-grid-points 1e8 --timeout 300
```
Files of any size work (no 2 GiB / 512 MiB limits); memory ≈ the rendered grid.
Downsampling keeps positions exact but cannot keep features narrower than one
output voxel — if a small lobe disappears, raise `--max-grid-points`.

**Spin-polarized CHGCAR — pick the grid**
```bash
# Collinear CHGCAR exposes charge / magnetization / spin_up / spin_down.
node {{MATVIZ_DIR}}/dist/render.js CHGCAR -o mag.png --grid magnetization --iso 0.02
# SOC / non-collinear exposes charge + magnetization_x / _y / _z.
node {{MATVIZ_DIR}}/dist/render.js CHGCAR -o mz.png  --grid magnetization_z --iso 0.02
```
The file must be named so matviz recognizes it as CHGCAR (`CHGCAR`, `AECCAR0/2`,
`PARCHG`). An unknown `--grid` prints the available grid names to stderr.

**Coordination polyhedra (silicon tetrahedra example)**
```bash
node {{MATVIZ_DIR}}/dist/render.js silicon.poscar \
  -o si_tet.png --polyhedra --supercell 2,2,2
```

**Element labels on every atom**
```bash
node {{MATVIZ_DIR}}/dist/render.js nacl.cif \
  -o labeled.png --labels --width 1200 --height 900
```

**Transparent background (for slide composition)**
```bash
node {{MATVIZ_DIR}}/dist/render.js graphene.xsf \
  -o graphene.png --bg transparent
```

**Per-atom vector arrows (magmom / force / velocity / displacement)**
```bash
node {{MATVIZ_DIR}}/dist/render.js NiO_POSCAR \
  -o nio_afm.png --vectors --view a
```
Generalized in v0.18 — the same overlay renders any per-atom vector field,
not just magnetic moments. Arrow length is proportional to |v| (default
1.0 Å per unit-magnitude; tune with `--vector-scale`). Red/Blue diverging
colormap is sign-coded by v_z (intuitive for collinear FM/AFM moments);
`--vector-colormap viridis` switches to sequential by |v| (better for
forces or comparing magnitudes across same-sign sites).

Auto-detection sources:
- **POSCAR**: `MAGMOM = ...` on the comment line. Collinear (N tokens → m_z)
  or non-collinear (3N → vector); compressed `k*v` form rejected. INCAR
  auto-discovery not yet supported — paste MAGMOM into the title.
- **XSF / AXSF**: trailing columns of PRIMCOORD lines. 5 cols → scalar
  along z; 7 cols → vector. Spec ambiguity (forces vs magmom) — the side
  panel labels these as "Atomic vector (col 5–7)".
- **Extended XYZ**: `Properties=...:magmom:R:3` / `:forces:R:3` /
  `:velocities:R:3` / `:displacements:R:3`. Width 1 = collinear scalar.
- **CIF**: `_atom_site_moment_cartn_*` or `_atom_site_moment_crystalaxis_*`.

`--magmom`, `--magmom-colormap`, `--magmom-scale` remain accepted as
aliases for back-compat.

**Partial occupancy (mineral mixed sites)**
```bash
node {{MATVIZ_DIR}}/dist/render.js mineral_mix.cif \
  -o mix.png --partial-occupancy
```
Sites with CIF `_atom_site_occupancy < 1` (e.g. (Mg,Fe) sites in
orthopyroxene) render as stacked transparent spheres with opacity equal to
each site's occupancy ratio — the perceived color is a weighted blend of the
species' palette colors. Default off shows the dominant species opaque,
which matches pre-v0.16 behavior for non-aware fixtures.

**Thermal ellipsoids (anisotropic displacement parameters)**
```bash
node {{MATVIZ_DIR}}/dist/render.js calcite.cif \
  -o calcite_ellip.png --ellipsoids --ellipsoid-contour 0.9
```
Atoms with CIF `_atom_site_aniso_U_*` render as probability-surface
ellipsoids (eigendecomposition of Uᵢⱼ → principal axes). Default contour
50% (χ²₃ ≈ 2.366); use `--ellipsoid-contour 0.9` for 90% (≈ 6.251). The
90% volume is roughly 4.3× the 50% volume. Site without aniso data fall
back to plain spheres in the same render.

**MD trajectory single key frame (extract Nth frame for report figure)**
```bash
node {{MATVIZ_DIR}}/dist/render.js XDATCAR \
  -o frame_50.png --frame 50 --view std
```
Trajectory formats are auto-detected by content (`Direct configuration=`
for XDATCAR, `ANIMSTEPS` for AXSF) so file extension or non-standard
filenames work. Frame index is 0-indexed; out-of-range clamps to nearest
valid frame with a warning. To render the entire trajectory as an
animation sequence see `--all-frames` below.

**MD trajectory animation sequence → ffmpeg gif/mp4**
```bash
# Render every frame to PNG sequence
node {{MATVIZ_DIR}}/dist/render.js XDATCAR \
  -o md.png --all-frames --view std

# Combine to gif (ffmpeg installed separately)
ffmpeg -framerate 30 -i md_%04d.png \
  -vf "scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  md.gif

# Or to mp4 (smaller filesize, sharper)
ffmpeg -framerate 30 -i md_%04d.png \
  -c:v libx264 -pix_fmt yuv420p md.mp4
```
The Puppeteer browser is reused across frames within a single
`--all-frames` invocation, so a 100-frame trajectory is roughly
2 + 100·1 sec instead of 100·2 sec.

**Multi-phase overlay (compare two structures in same viewport)**
```bash
node {{MATVIZ_DIR}}/dist/render.js relaxed.cif \
  -o overlay.png --phase unrelaxed.cif
```
The primary structure renders opaque; each `--phase` file renders as
transparent (50%) atoms in cell-overlap mode (default offset (0,0,0)).
Multi-phase comparison stacks: `--phase a.cif --phase b.cif`. Useful for
relaxed vs unrelaxed, DFT functional comparison, or polymorph overlay
visualization. Combine with `--compare-to-phase` to add NN displacement
arrows + RMSD numerical summary in stdout.

**Compare two structures (NN displacement arrows + RMSD summary)**
```bash
node {{MATVIZ_DIR}}/dist/render.js relaxed.cif \
  -o compare.png --phase unrelaxed.cif --compare-to-phase
# stdout:
#   Saved: compare.png
#   [comparison] RMSD: 0.127 Å (matched 8, unmatched 0, max 0.226 Å, mean 0.078 Å, p95 0.226 Å)
```
For each primary atom, the nearest same-species atom in the first
`--phase` is matched (greedy, no reuse). Displacement arrows are coloured
by Viridis (low → dark purple, high → yellow) and the per-pair magnitudes
feed RMSD / max / mean / p95 reported on stdout in a single
`[comparison]` line — easy to grep from build logs. Matching is
PBC-aware when both lattices are identical (minimum-image convention);
otherwise straight Euclidean. Atoms without a same-species partner count
as `unmatched`. Requires `--phase`; `--all-frames` is rejected (per-frame
comparison is deferred to a future v0.17.x).

**Quick info-only query (no PNG)** — v0.20+
```bash
node {{MATVIZ_DIR}}/dist/render.js silicon.poscar --info
# Structure: 2 atoms, Si2
# Lattice: a=3.840, b=3.840, c=3.840, α=60.00°, β=60.00°, γ=60.00°
# Volume: 40.03 Å³
# Space group: Fd-3m (#227)
# Crystal system: cubic
# Hall number: 525
```
Without `-o`, `--info` skips Puppeteer entirely (sub-100 ms cold). Add
`--json` for machine-readable output. Combine with `-o foo.png` to print
**and** render. Backed by `@spglib/moyo-wasm` symmetry detection — POSCAR,
XSF, XYZ, PDB, Cube, CHGCAR, QE input/output, FHI-aims geometries all
report a real space group instead of the legacy `P1` fallback.

**Wulff construction (Au cuboctahedron)**
```bash
node {{MATVIZ_DIR}}/dist/render.js Au_POSCAR \
  -o au_wulff.png --wulff "1,0,0,1.0; -1,0,0,1.0; 0,1,0,1.0; 0,-1,0,1.0; 0,0,1,1.0; 0,0,-1,1.0; 1,1,1,1.15; 1,1,-1,1.15; 1,-1,1,1.15; 1,-1,-1,1.15; -1,1,1,1.15; -1,1,-1,1.15; -1,-1,1,1.15; -1,-1,-1,1.15"
```
For each (h,k,l,γ): h·a* + k·b* + l·c* gives the outward face normal,
γ the offset (Wulff theorem: distance ∝ surface energy). Triple-plane
intersection gives polytope vertices, ConvexGeometry triangulates.
The polytope sits at the cell origin as a semi-transparent blue mesh
with dark blue wireframe edges. **No symmetry expansion** — list every
crystallographically equivalent face explicitly. Cubic {100} = 6 faces,
{111} = 8 faces.

## Supported input formats

CIF, POSCAR/CONTCAR, VASP `*.vasp`, XSF (with/without volumetric), XYZ, PDB,
Gaussian Cube (`.cube`/`.cub`), CHGCAR/AECCAR/PARCHG, Quantum ESPRESSO `.out`,
FHI-aims `geometry.in`. Format is auto-detected from filename + content.

## Verification workflow

After each render, follow this three-step check before reporting success:

1. **Bash exit status** — the command must return 0.
2. **`Read` the PNG** — visually confirm atoms, bonds, cell match expectations.
   If the image is blank or garbled, something went wrong silently.
3. **Compare to user intent** — if the user said "along c-axis", confirm the view
   actually shows the c-axis direction (you may need to re-render with a different
   `--view` value and compare).

If the output is wrong, do not retry with the same arguments. Diagnose first
(parser issue? wrong view? bonds missing?) and adjust.

## Troubleshooting

- **Blank/white image**:
  - Before v0.23.1, large structures (≳ 40 Å, e.g. big supercells or a molecule
    in a large box) were washed into the background by a fixed fog density, and
    structures ≳ 160 Å were clipped entirely — on `--bg white` that is an all-white
    PNG. Fixed in v0.23.1 (fog and clipping now scale with the camera distance);
    rebuild with `npm run build` if you still see it.
  - `--bg transparent` writes alpha-0 pixels; viewers with a white canvas
    (Preview, Word, slides) show them as white. Use an explicit `--bg` when the
    image will not be composited.
  - Otherwise a WebGL context issue: the renderer uses SwiftShader software
    rendering; if Chromium isn't downloading or crashes, re-run `npm install`
    in `{{MATVIZ_DIR}}`.
- **Isosurface from a huge file looks coarse or a small lobe is missing**: the
  grid was downsampled to `--max-grid-points` (stderr prints
  `[matviz] grid A → B (factor N, trilinear)`). Raise the budget, e.g.
  `--max-grid-points 1e8 --timeout 300`.
- **`Navigation timeout of 30000 ms exceeded`**: the scene took longer than the
  default 30 s to build (very large supercell or volumetric grid). Pass
  `--timeout 120`.
- **"no input file specified"**: pass the structure file as the first positional
  argument (before any flags).
- **Wrong colors**: check `--palette`. Dark palette brightens CPK colors for dark
  backgrounds; light palette uses original CPK.
- **Bonds missing**: check `--no-bonds` wasn't passed. For large distances, note
  that the default cutoff is `(rA + rB + 0.3) Å` per element pair.
- **Structure cut off**: try `--view std` (default) or reduce `--supercell`.
- **`node: command not found`**: install Node.js 18+ before running the CLI.
- **`Cannot find module 'puppeteer'`**: run `npm install` in `{{MATVIZ_DIR}}`.

## Integration with other skills

- **labscribe**: when producing a computational physics report, render the input
  geometry and any optimized structures, then embed the PNGs in the report.
- Output PNGs should go into the report's directory (e.g., `reports/{topic}/fig_*.png`)
  with relative-path image links in the markdown.

## Reference

Project source: `{{MATVIZ_DIR}}`. Full option parsing and rendering logic in
`scripts/render.ts` (built to `dist/render.js`). Parsers shared with VSCode
extension in `src/parsers/`.
