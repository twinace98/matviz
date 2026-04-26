---
name: matviz-render
description: >
  Render crystal structure files (CIF, POSCAR, XSF, XYZ, PDB, Gaussian Cube, CHGCAR,
  Quantum ESPRESSO output, FHI-aims geometry.in) to PNG images via a headless CLI.
  Supports ball-and-stick, space-filling, stick, and wireframe styles; orthographic
  or perspective camera; axis-aligned views (a/b/c/a*/b*/c*/std); supercell expansion;
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
| `--view` | `a`\|`b`\|`c`\|`a*`\|`b*`\|`c*`\|`std` | `std` | Camera direction |
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
| `--plane` | `h,k,l` | off | Add lattice plane |
| `--magmom` | flag | off | Render magnetic-moment arrows on atoms (auto-on if structure has magMom from POSCAR title MAGMOM or CIF `_atom_site_moment_*`) |
| `--magmom-colormap` | `redblue`\|`viridis` | `redblue` | Arrow color: `redblue` = sign-coded by mz (FM/AFM intuition); `viridis` = sequential by \|m\| |
| `--magmom-scale` | number | `1.0` | Arrow length (Å per μB) |
| `--partial-occupancy` | flag | off | Render sites with `_atom_site_occupancy` < 1 as transparent atoms (opacity = occupancy). Default off shows the dominant species opaque. |
| `--ellipsoids` | flag | off | Render thermal ellipsoids for atoms with anisotropic U (CIF `_atom_site_aniso_U_*`). Phong-only path. |
| `--ellipsoid-contour` | `0.5`\|`0.9` | `0.5` | Probability contour level. Implies `--ellipsoids`. |
| `--wulff` | `"h,k,l,γ; …"` | off | Render Wulff polytope from semicolon-separated (h,k,l,γ) tuples. γ = relative surface energy per face. |
| `--frame` | `N` (0-indexed) | `0` | Trajectory file (XDATCAR / AXSF / extended XYZ): render the Nth frame. Out-of-range clamps with warn. Ignored for single-frame files. |
| `--all-frames` | flag | off | Render every trajectory frame as a PNG sequence: `<output>_NNNN.png` (1-indexed, 4-digit zero-padded; auto-expands beyond 9999 frames). Conflicts with `--frame` (all wins + warn). |
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

**Magnetic moment vectors (NiO antiferromagnet, MAGMOM in POSCAR title)**
```bash
node {{MATVIZ_DIR}}/dist/render.js NiO_POSCAR \
  -o nio_afm.png --magmom --view a
```
The arrow length is proportional to |m| (default 1.0 Å per μB; tune with
`--magmom-scale`). Red/Blue diverging colormap is sign-coded by mz
(intuitive for collinear FM/AFM); switch to `--magmom-colormap viridis`
for sequential colormap by |m| (better when comparing magnitudes across
sites with the same sign).

For VASP POSCARs the parser reads `MAGMOM = ...` from the comment line
(line 1). Collinear (N tokens for N atoms → mz-only), non-collinear
(3N tokens → full vector), or compressed `k*v` form (rejected). Adjacent
INCAR auto-discovery is not yet supported — paste the MAGMOM into the
POSCAR title or pass the file with that title rewritten.

CIF files use `_atom_site_moment_cartn_*` or `_atom_site_moment_crystalaxis_*`
loops; the parser handles both.

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

- **Blank/white image**: likely WebGL context issue. The renderer uses SwiftShader
  software rendering; if Chromium isn't downloading or crashes, re-run `npm install`
  in `{{MATVIZ_DIR}}`.
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
