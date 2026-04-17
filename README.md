# MatViz — Crystal Structure Viewer for VSCode

Interactive 3D crystal structure visualization as a VSCode extension, inspired by VESTA.

## Quick start

1. Install the extension (`npm run install-all`, or grab the `.vsix` from releases and `code --install-extension …`).
2. Open a structure file in VSCode. Unambiguous formats (`.cif`, `.xsf`, `POSCAR`, `.xyz`, `.pdb`, `.cube`, `CHGCAR`, `geometry.in`, …) open directly in the 3D viewer.
3. For QE input/output (`.in`, `.out`, `.stdin`, `.stdout`, `.pw`) the file opens as text first — click **Open in MatViz** in the editor title bar to render it.
4. Rotate with the mouse (left-drag) or the ↑↓←→ buttons / keys. Zoom with the wheel or the +/− buttons. Everything else lives in the collapsible left side panel.
5. Hover any button or control for a tooltip describing what it does.

## Supported Formats

| Format | Extensions / Filenames | Default open |
|---|---|---|
| CIF | `*.cif` | MatViz |
| POSCAR / VASP | `*.poscar`, `*.vasp`, `POSCAR`, `CONTCAR` | MatViz |
| XSF | `*.xsf`, `*.axsf` | MatViz |
| XYZ | `*.xyz` | MatViz |
| PDB | `*.pdb` | MatViz |
| Gaussian Cube | `*.cube`, `*.cub` | MatViz |
| VASP Charge Density | `CHGCAR`, `AECCAR0`, `AECCAR2`, `PARCHG` | MatViz |
| FHI-aims | `geometry.in` | MatViz |
| Quantum ESPRESSO | `*.in`, `*.out`, `*.stdin`, `*.stdout`, `*.pw` | Text first — click **Open in MatViz** |

Unambiguous crystallography files open directly in the 3D viewer.
Ambiguous extensions used in lab workflows (QE input/output, SLURM stdout,
etc.) open as text by default; press the **Open in MatViz** button in the
editor title bar to switch to the viewer. If parsing fails, an error toast
with an **Open as Text** action is shown.

## UI Layout

```
+--[Top Toolbar]----------------------------------------------+
|  a b c a* b* c*  |  home  |  arrows/rotate  |  zoom  | cam |
+--+--+-------------------------------------------------------+
|Mo|  | Side Panel (resizable)                                 |
|de|  |  - Structure info                                      |
|  |  |  - Display style                                       |
|ba|  |  - Camera (Ortho/Persp)                                |
|r |  |  - Visibility toggles                                  |
|  |  |  - Axes size slider                                    |
|  |  |  - Supercell inputs                                    |
|  |  |  - Iso-level (volumetric)                              |
|  |  |  - Atom properties                                     |
|  |  |  - Bond properties                                     |
+--+--+-------------------------------------------------------+
|                                                              |
|                    3D Viewport                                |
|                                                              |
|  [Axis indicator]                                            |
+--------------------------------------------------------------+
```

## Features

### Rendering
- **4 display styles**: Ball-and-stick, Space-filling, Stick, Wireframe
- **Orthographic / Perspective** camera toggle
- **Atom labels** (sprite-based, always on top)
- **Coordination polyhedra** with transparent faces and edge outlines
- **Depth fog** matching VSCode theme
- **Adaptive LOD**: geometry detail scales with atom count

### Navigation
- **Mouse**: Left-drag to rotate (quaternion-based, no gimbal lock), right-drag to pan, scroll to zoom
- **Constrained rotation**: Shift+drag locks to single axis, Ctrl/Cmd+drag for screen-Z roll
- **Quick views**: a, b, c, a\*, b\*, c\* axis buttons with animated transitions
- **Standard orientation**: Home button (c-axis up, view from a\*)
- **Step rotation**: Arrow buttons and keyboard arrows (Shift for fine 1-degree steps)
- **Zoom buttons**: +/- with configurable step percentage

### Crystallography
- **CIF symmetry expansion**: Parses `_symmetry_equiv_pos_as_xyz` and `_space_group_symop_operation_xyz`, applies to asymmetric unit with duplicate removal
- **Supercell expansion**: 1-5x per axis
- **Boundary atoms**: VESTA-style periodic image atoms on cell faces/edges/corners (toggle on/off)
- **Unit cell wireframe**: Solid outer boundary + dashed internal cell boundaries for supercells
- **Lattice planes**: Add by Miller indices (hkl) via command palette
- **Axis indicator**: a (red), b (green), c (blue) arrows in bottom-left corner, synchronized with camera rotation

### Interaction
- **Navigate mode** (default): Click atom to view info (element, unit cell index, cartesian/fractional coords)
- **Measure mode**: Click 2 atoms for distance, 3 for angle, 4 for dihedral angle. Measurements shown as dashed lines with labels.
- **Selection highlight**: Selected atoms highlighted in cyan
- Mode toggle via left toolbar (diamond / arrow icons)

### Atom & Bond Properties
- **Per-element**: Color picker, radius slider, visibility toggle
- **Per-bond pair**: Enable/disable checkbox, min/max distance cutoff inputs
- Expand "Atoms" / "Bonds" sections in the side panel

### Volumetric Data
- **Isosurface rendering** via CPU marching cubes (positive/negative lobes in blue/red)
- **Iso-level control**: Slider + numeric input for precise values
- Supported in XSF (BLOCK_DATAGRID_3D), Gaussian Cube, and CHGCAR formats

### Export
- **Screenshot**: Camera icon in top toolbar, exports PNG at 2x resolution
- **Structure export**: `MatViz: Export as CIF` / `MatViz: Export as POSCAR` via command palette
- **Open as text**: Document icon opens the file in VSCode's default text editor

### UI
- All UI elements follow VSCode theme (dark/light)
- Side panel is resizable by dragging the right edge
- State persistence: display style, camera position, supercell settings are preserved across tab switches
- **Tooltips on hover** for every toolbar button, slider, input, and side-panel control — hover any control to see what it does

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `↑` / `↓` | Rotate model up / down (model-space, matches button direction) |
| `←` / `→` | Rotate model left / right |
| Shift + Arrow | Fine rotate (1-degree step) |
| `+` / `-` | Zoom in / out |
| `Escape` | Clear selection and measurements |

The rotation *step size* is set by the **Step(°)** input in the top toolbar
(default 15°); the zoom step by **Step(%)** (default 10%).

## Commands (Command Palette)

Open the Command Palette with **Cmd+Shift+P** (macOS) / **Ctrl+Shift+P** (Windows/Linux) and type `MatViz` to see all available commands.

| Command | Description |
|---|---|
| `MatViz: Reset Camera` | Reset to default view |
| `MatViz: Toggle Bonds` | Show/hide all bonds |
| `MatViz: View Along Direction [uvw]` | Camera along crystallographic direction |
| `MatViz: View Normal to Plane (hkl)` | Camera normal to Miller plane |
| `MatViz: Add Lattice Plane (hkl)` | Add colored lattice plane |
| `MatViz: Clear Lattice Planes` | Remove all lattice planes |
| `MatViz: Export Screenshot` | Save PNG screenshot |
| `MatViz: Export as CIF` | Export structure as CIF |
| `MatViz: Export as POSCAR` | Export structure as POSCAR |

## Build

```bash
npm install
npm run build          # esbuild dual-entry (extension + webview)
npx tsc --noEmit       # type check only
```

## Install from Source

Full install (VSCode extension + Claude CLI skill):

```bash
npm install
npm run install-all
```

Or step-by-step:

```bash
npm install
npm run build
npx @vscode/vsce package --no-dependencies
code --install-extension vscode-matviz-0.13.1.vsix --force
npm run install-skill   # optional — only if you use Claude Code
```

## Headless CLI Renderer

MatViz also ships a command-line renderer for producing PNG images of
structures without opening VSCode — useful in scripts, CI pipelines, or
AI-assisted report workflows.

```bash
node dist/render.js structure.cif -o out.png [options]
```

Common options:

| Flag | Purpose |
|---|---|
| `-o <path>` | Output PNG path (required) |
| `--style <ball-and-stick\|space-filling\|stick\|wireframe>` | Rendering style |
| `--view <a\|b\|c\|a*\|b*\|c*\|std>` | Predefined camera view |
| `--supercell a,b,c` | Expand cell (e.g. `2,2,1`) |
| `--camera <ortho\|persp>` | Projection |
| `--palette <dark\|light>` | Theme |
| `--bg <color>` | Background color (CSS hex/name) |
| `--labels` / `--polyhedra` | Element labels / coordination polyhedra |
| `--iso <level>` | Isosurface level for volumetric files |
| `--no-bonds` / `--no-boundary` / `--no-cell` | Disable features |

Run `node dist/render.js --help` for the full list.

The `matviz-render` Claude skill lets Claude Code invoke the CLI when you
ask things like "render this POSCAR" or "보고서에 구조 이미지 넣어줘".
`npm run install-all` installs both the extension and the skill;
`npm run install-skill` installs the skill only.

## Architecture

Two execution contexts, two bundles:

- **Extension host** (Node.js): File parsing, webview lifecycle, commands
- **Webview** (browser): Three.js rendering, user interaction

Data flow: `file → parser → CrystalStructure JSON → postMessage → webview → Three.js scene`

## License

See LICENSE file.
