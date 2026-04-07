# MatViz — Crystal Structure Viewer for VSCode

Interactive 3D crystal structure visualization as a VSCode extension, inspired by VESTA.

## Supported Formats

| Format | Extensions / Filenames |
|---|---|
| CIF | `*.cif` |
| POSCAR / VASP | `*.poscar`, `*.vasp`, `POSCAR`, `CONTCAR` |
| XSF | `*.xsf` |
| XYZ | `*.xyz` |
| PDB | `*.pdb` |
| Gaussian Cube | `*.cube`, `*.cub` |
| VASP Charge Density | `CHGCAR`, `AECCAR0`, `AECCAR2`, `PARCHG` |
| Quantum ESPRESSO | `*.out` |
| FHI-aims | `geometry.in` |

Files are automatically opened with the 3D viewer. Click the document icon in the top toolbar to open the same file as plain text.

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

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Arrow keys | Rotate (15-degree steps) |
| Shift + Arrow keys | Fine rotate (1-degree steps) |
| `+` / `-` | Zoom in / out |
| `Escape` | Clear selection and measurements |

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

```bash
npm run build
npx @vscode/vsce package --no-dependencies
code --install-extension vscode-matviz-0.10.0.vsix --force
```

## Architecture

Two execution contexts, two bundles:

- **Extension host** (Node.js): File parsing, webview lifecycle, commands
- **Webview** (browser): Three.js rendering, user interaction

Data flow: `file → parser → CrystalStructure JSON → postMessage → webview → Three.js scene`

## License

See LICENSE file.
