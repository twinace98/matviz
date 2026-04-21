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
