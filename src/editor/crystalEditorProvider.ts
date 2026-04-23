import * as vscode from 'vscode';
import { CrystalStructure, CrystalTrajectory, VolumetricData } from '../parsers/types';
import { parseStructureFileTraj } from '../parsers/index';
import { exportCif, exportPoscar } from '../parsers/exporters';
import path from 'path';

class CrystalDocument implements vscode.CustomDocument {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly trajectory: CrystalTrajectory,
    public readonly volumetric?: VolumetricData
  ) {}

  // Convenience for code paths that only care about the first frame
  // (export, info display defaults). Trajectory-aware code reads
  // .trajectory directly.
  get structure(): CrystalStructure { return this.trajectory.frames[0]; }

  dispose() {}
}

export class CrystalEditorProvider implements vscode.CustomReadonlyEditorProvider<CrystalDocument> {
  private activeWebview: vscode.Webview | undefined;
  private activeDocument: CrystalDocument | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async exportStructure(format: 'cif' | 'poscar') {
    if (!this.activeDocument) {
      vscode.window.showWarningMessage('No structure open to export.');
      return;
    }
    const content = format === 'cif'
      ? exportCif(this.activeDocument.structure)
      : exportPoscar(this.activeDocument.structure);
    const ext = format === 'cif' ? 'cif' : 'poscar';
    const uri = await vscode.window.showSaveDialog({
      filters: { [format.toUpperCase()]: [ext] },
      defaultUri: vscode.Uri.file(
        this.activeDocument.uri.fsPath.replace(/\.[^.]+$/, `.${ext}`)
      ),
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<CrystalDocument> {
    const data = await vscode.workspace.fs.readFile(uri);
    const content = new TextDecoder('utf-8').decode(data);
    const filename = path.basename(uri.fsPath);
    try {
      // 17.1.0: trajectory-aware entry. For single-frame files this wraps
      // into a 1-frame trajectory (no observable behavior change). 17.1.1+
      // multi-frame parsers (AXSF, XDATCAR, extended XYZ) populate frames.
      const result = parseStructureFileTraj(content, filename);
      return new CrystalDocument(uri, result.trajectory, result.volumetric);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      vscode.window.showErrorMessage(
        `MatViz could not parse ${filename}: ${msg}`,
        'Open as Text'
      ).then(choice => {
        if (choice === 'Open as Text') {
          vscode.commands.executeCommand('vscode.openWith', uri, 'default');
        }
      });
      throw err;
    }
  }

  async resolveCustomEditor(
    document: CrystalDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.activeWebview = webviewPanel.webview;
    this.activeDocument = document;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') {
        // 17.1.0 dispatch: route multi-frame trajectories to loadTrajectory,
        // single-frame to loadStructure (cheaper — webview skips trajectory
        // state). Until 17.1.1 lands AXSF parsing, the trajectory always has
        // length 1, so loadStructure is taken — backward-compat preserved.
        if (document.trajectory.frames.length > 1) {
          webviewPanel.webview.postMessage({
            type: 'loadTrajectory',
            data: document.trajectory,
          });
        } else {
          webviewPanel.webview.postMessage({
            type: 'loadStructure',
            data: document.structure,
          });
        }
        if (document.volumetric) {
          webviewPanel.webview.postMessage({
            type: 'loadVolumetric',
            data: {
              origin: document.volumetric.origin,
              lattice: document.volumetric.lattice,
              dims: document.volumetric.dims,
              data: Array.from(document.volumetric.data),
            },
          });
        }
      }
      if (msg.type === 'openAsText') {
        vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      }
      // 17.2.1 add-phase via side-panel button (webview-initiated; no
      // command palette round-trip needed).
      if (msg.type === 'addPhaseRequest') {
        vscode.commands.executeCommand('matviz.addPhase');
      }
      // 17.2.1 compare-to-phase failure → vscode toast (replaces console.warn)
      if (msg.type === 'comparisonResult') {
        const r = msg as { type: 'comparisonResult'; ok: boolean; reason?: string };
        if (!r.ok && r.reason) {
          vscode.window.showWarningMessage(`MatViz: ${r.reason}`);
        }
      }
    });

    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.visible) {
        this.activeWebview = webviewPanel.webview;
        this.activeDocument = document;
      }
    });

    webviewPanel.onDidDispose(() => {
      if (this.activeWebview === webviewPanel.webview) {
        this.activeWebview = undefined;
        this.activeDocument = undefined;
      }
    });
  }

  postMessageToActive(message: unknown) {
    this.activeWebview?.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} blob: data:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Crystal Structure</title>
</head>
<body>
  <canvas id="canvas"></canvas>

  <!-- Mode toolbar (far left) -->
  <div id="mode-bar">
    <button id="mode-navigate" class="mode-btn active" title="Navigate (click atom for info)">&#x25C7;</button>
    <button id="mode-measure" class="mode-btn" title="Measure (click 2/3/4 atoms)">&#x2194;</button>
    <div class="mode-sep"></div>
    <button id="panel-toggle" class="mode-btn" title="Toggle side panel">&#x25C0;</button>
    <button id="help-btn" class="mode-btn" title="Keyboard shortcuts (?)">?</button>
  </div>

  <!-- Shortcuts help overlay -->
  <div id="help-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <div id="help-card">
      <div id="help-head">
        <span id="help-title">Keyboard Shortcuts</span>
        <button id="help-close" class="bar-btn" title="Close (Esc)" aria-label="Close">&#x2715;</button>
      </div>
      <div id="help-body">
        <div class="help-col">
          <div class="help-h">Rotation</div>
          <div class="help-row"><kbd>&#x2190;</kbd><kbd>&#x2193;</kbd><kbd>&#x2191;</kbd><kbd>&#x2192;</kbd><span>Rotate by step</span></div>
          <div class="help-row"><kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd><span>Rotate (vim keys)</span></div>
          <div class="help-row"><kbd>[</kbd> / <kbd>]</kbd><span>Rotate CCW / CW</span></div>
          <div class="help-row"><kbd>Shift</kbd>+key<span>Rotate by 1&deg; (arrows / hjkl / [ ])</span></div>
          <div class="help-h">Zoom</div>
          <div class="help-row"><kbd>+</kbd> / <kbd>=</kbd><span>Zoom in</span></div>
          <div class="help-row"><kbd>&minus;</kbd><span>Zoom out</span></div>
          <div class="help-row"><span>Mouse wheel</span><span>Zoom</span></div>
        </div>
        <div class="help-col">
          <div class="help-h">Navigation</div>
          <div class="help-row"><span>Left drag</span><span>Rotate</span></div>
          <div class="help-row"><span>Right / Mid drag</span><span>Pan</span></div>
          <div class="help-row"><span>Click atom</span><span>Select / info</span></div>
          <div class="help-h">Modes &amp; Misc</div>
          <div class="help-row"><kbd>Esc</kbd><span>Close help / clear selection / measurement</span></div>
          <div class="help-row"><kbd>?</kbd><span>This help</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Top toolbar -->
  <div id="top-bar">
    <div class="bar-group" title="Axis Views">
      <button id="view-a" class="bar-btn axis-btn" title="View along a axis">a</button>
      <button id="view-b" class="bar-btn axis-btn" title="View along b axis">b</button>
      <button id="view-c" class="bar-btn axis-btn" title="View along c axis">c</button>
      <button id="view-a*" class="bar-btn axis-btn" title="View along a* (reciprocal a) axis">a*</button>
      <button id="view-b*" class="bar-btn axis-btn" title="View along b* (reciprocal b) axis">b*</button>
      <button id="view-c*" class="bar-btn axis-btn" title="View along c* (reciprocal c) axis">c*</button>
    </div>
    <span class="bar-sep"></span>
    <div class="bar-group" title="Standard Orientation">
      <button id="std-orient" class="bar-btn" title="Standard orientation (c-axis up, view from a*)">&#x2302;</button>
    </div>
    <span class="bar-sep"></span>
    <div class="bar-group" title="Step Rotation">
      <button id="rot-up" class="bar-btn" title="Rotate up">&#x2191;</button>
      <button id="rot-down" class="bar-btn" title="Rotate down">&#x2193;</button>
      <button id="rot-left" class="bar-btn" title="Rotate left">&#x2190;</button>
      <button id="rot-right" class="bar-btn" title="Rotate right">&#x2192;</button>
      <button id="rot-ccw" class="bar-btn" title="Rotate CCW">&#x21BA;</button>
      <button id="rot-cw" class="bar-btn" title="Rotate CW">&#x21BB;</button>
      <label class="bar-label" title="Rotation step (degrees) per arrow-button / arrow-key press">Step(&deg;):
        <input type="number" id="step-angle" value="15" min="1" max="90" step="1" class="bar-input" title="Rotation step in degrees (1–90)">
      </label>
    </div>
    <span class="bar-sep"></span>
    <div class="bar-group" title="Zoom">
      <button id="zoom-in" class="bar-btn" title="Zoom in">+</button>
      <button id="zoom-out" class="bar-btn" title="Zoom out">&minus;</button>
      <button id="zoom-fit" class="bar-btn" title="Fit to view">&#x2922;</button>
      <label class="bar-label" title="Zoom step (percent) per zoom-button press or wheel tick">Step(%):
        <input type="number" id="step-zoom" value="10" min="1" max="50" step="1" class="bar-input" title="Zoom step in percent (1–50)">
      </label>
    </div>
    <span class="bar-sep"></span>
    <div class="bar-group">
      <button id="screenshot-btn" class="bar-btn" title="Screenshot">&#x1F4F7;</button>
      <button id="text-toggle" class="bar-btn" title="Toggle raw text view">&#x1F4C4;</button>
      <button id="palette-toggle" class="bar-btn" title="Color palette: Dark">&#x263E;</button>
    </div>
  </div>

  <!-- Left sidebar controls -->
  <div id="side-panel">
    <div id="panel-resize"></div>
    <div id="info"></div>
    <div class="panel-section">
      <div class="panel-label" title="Whether the side panel pushes the canvas aside (Offset) or floats above it (Overlay)">Layout</div>
      <div class="layout-toggle-row">
        <button id="layout-offset-btn" class="panel-btn active" title="Offset: canvas starts right of the panel — no atom is ever hidden behind it">Offset</button>
        <button id="layout-overlay-btn" class="panel-btn" title="Overlay: panel floats above the canvas (classic mode)">Overlay</button>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-label">Style</div>
      <select id="display-style" class="panel-select" title="Rendering style for atoms and bonds">
        <option value="ball-and-stick" selected title="Atoms as spheres, bonds as split-color cylinders">Ball &amp; Stick</option>
        <option value="space-filling" title="Atoms at full van der Waals radius, no bonds">Space-filling</option>
        <option value="stick" title="Bonds only, atoms shrunk to stick radius">Stick</option>
        <option value="wireframe" title="Lines only">Wireframe</option>
      </select>
    </div>
    <div class="panel-section">
      <div class="panel-label">Camera</div>
      <button id="camera-toggle" class="panel-btn active" title="Toggle between orthographic and perspective projection">Ortho</button>
    </div>
    <div class="panel-section">
      <div class="panel-label">Visibility</div>
      <div class="toggle-group">
        <label class="toggle" title="Show bonds between atoms"><input type="checkbox" id="bonds-check" checked><span>Bonds</span></label>
        <label class="toggle" title="Show element symbol labels on atoms"><input type="checkbox" id="labels-check"><span>Labels</span></label>
        <label class="toggle" title="Show coordination polyhedra around selected elements"><input type="checkbox" id="poly-check"><span>Polyhedra</span></label>
        <label class="toggle" title="Show boundary atoms (atoms on cell faces wrapped to neighbors)"><input type="checkbox" id="boundary-check" checked><span>Boundary</span></label>
        <label class="toggle" title="Show dashed inner cell lines for supercells"><input type="checkbox" id="celldash-check" checked><span>Cell lines</span></label>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-label" title="Screen size (pixels) of the axis indicator widget">Axes size</div>
      <input type="range" id="axis-size" class="iso-slider" min="60" max="400" step="10" value="300" title="Axis indicator size (60–400 px)">
    </div>
    <div class="panel-section">
      <div class="panel-label" title="Expand the unit cell along each lattice vector">Supercell</div>
      <div class="sc-row">
        <input type="number" id="sc-a" value="1" min="1" max="5" class="sc-input" title="Supercell repeats along a (1–5)">
        <input type="number" id="sc-b" value="1" min="1" max="5" class="sc-input" title="Supercell repeats along b (1–5)">
        <input type="number" id="sc-c" value="1" min="1" max="5" class="sc-input" title="Supercell repeats along c (1–5)">
      </div>
    </div>
    <div class="panel-section hidden" id="iso-section">
      <div class="panel-label" title="Isosurface contour level for the loaded volumetric data">Iso-level</div>
      <input type="range" id="iso-slider" class="iso-slider" min="0" max="1" step="0.001" value="0" title="Drag to change isosurface level (absolute value; negative lobe drawn automatically)">
      <input type="number" id="iso-input" class="sc-input full-width" step="any" value="0" title="Isosurface level (numeric entry)">
    </div>
    <div class="panel-section hidden" id="ellipsoids-section">
      <div class="panel-label" title="Anisotropic-displacement ellipsoids parsed from CIF _atom_site_aniso_*">Thermal ellipsoids</div>
      <div class="toggle-group">
        <label class="toggle" title="Render atoms with anisotropic displacement parameters as probability ellipsoids (Phong path forced)"><input type="checkbox" id="ellipsoids-check"><span>Show ellipsoids</span></label>
      </div>
      <div class="toggle-group" id="ellipsoid-contour-row" title="Probability contour level (χ²₃ table)">
        <label class="toggle"><input type="radio" name="ellipsoid-contour" value="0.5" id="ellipsoid-contour-50" checked><span>50%</span></label>
        <label class="toggle"><input type="radio" name="ellipsoid-contour" value="0.9" id="ellipsoid-contour-90"><span>90%</span></label>
      </div>
    </div>
    <div class="panel-section hidden" id="partial-occupancy-section">
      <div class="panel-label" title="Sites with _atom_site_occupancy < 1 (mixed-occupancy)">Partial occupancy</div>
      <div class="toggle-group">
        <label class="toggle" title="Render partial-occupancy sites as transparent atoms with opacity = occupancy ratio (per-site preserved)"><input type="checkbox" id="partial-occ-check"><span>Show partial occupancy</span></label>
      </div>
    </div>
    <div class="panel-section hidden" id="trajectory-section">
      <div class="panel-label" title="MD trajectory from AXSF / XDATCAR / extended XYZ">Trajectory</div>
      <div class="trajectory-controls">
        <button id="traj-play-btn" class="panel-btn" title="Play / Pause (Space)">▶</button>
        <input type="range" id="traj-slider" min="0" max="0" step="1" value="0" title="Scrub frames">
        <input type="number" id="traj-frame-input" class="traj-frame-input" min="1" value="1" title="Jump to frame">
        <span id="traj-frame-label" class="traj-frame-label">/ 0</span>
      </div>
      <div class="trajectory-controls">
        <span class="traj-control-label" title="Playback speed multiplier">Speed</span>
        <input type="range" id="traj-speed-slider" min="0.25" max="2" step="0.25" value="1" title="0.25× – 2×">
        <span id="traj-speed-label" class="traj-frame-label">1.00×</span>
      </div>
      <div class="toggle-group">
        <label class="toggle" title="Repeat playback at end of trajectory"><input type="checkbox" id="traj-loop-check" checked><span>Loop</span></label>
        <label class="toggle" title="Re-detect bonds at every frame (slow — disable above ~5k atoms; off by default uses frame-0 bonds for all frames)"><input type="checkbox" id="traj-bond-recompute"><span>Recompute bonds every frame (slow)</span></label>
      </div>
    </div>
    <div class="panel-section hidden" id="phases-section">
      <div class="panel-label" title="Overlay structures rendered alongside the primary">Phases (overlay)</div>
      <div id="phases-list"></div>
      <button id="add-phase-btn" class="panel-btn full-width" title="Add a structure file to overlay">+ Add Phase…</button>
      <div class="toggle-group" id="comparison-row">
        <label class="toggle" title="Display NN displacement arrows from primary atoms to first secondary phase atoms (Viridis colormap)"><input type="checkbox" id="compare-toggle"><span>Compare to first phase (displacement arrows)</span></label>
      </div>
      <div id="comparison-stats" class="comparison-stats hidden"></div>
    </div>
    <div class="panel-section hidden" id="magnetic-moments-section">
      <div class="panel-label" title="Magnetic moment vectors from VASP MAGMOM (POSCAR title line) or CIF _atom_site_moment_*">Magnetic moments</div>
      <div class="toggle-group">
        <label class="toggle" title="Render arrows on atoms with non-zero magnetic moment (length ∝ |m|, color by colormap)"><input type="checkbox" id="magmom-check"><span>Show moments</span></label>
      </div>
      <div class="toggle-group" id="magnetic-colormap-row" title="Colormap for arrow color">
        <label class="toggle"><input type="radio" name="mag-colormap" value="redblue" id="mag-cmap-redblue" checked><span>Red/Blue</span></label>
        <label class="toggle"><input type="radio" name="mag-colormap" value="viridis" id="mag-cmap-viridis"><span>Viridis</span></label>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-label panel-label-toggle" id="atoms-toggle" title="Expand per-element color / radius / visibility overrides">Atoms &#x25B6;</div>
      <div id="atoms-props" class="props-list hidden"></div>
    </div>
    <div class="panel-section hidden" id="poly-centers-section">
      <div class="panel-label panel-label-toggle" id="poly-centers-toggle" title="Choose which element's atoms become polyhedra centers">Polyhedra centers &#x25B6;</div>
      <div id="poly-centers-props" class="props-list hidden"></div>
    </div>
    <div class="panel-section">
      <div class="panel-label panel-label-toggle" id="bonds-toggle" title="Expand per-pair bond cutoff settings">Bonds &#x25B6;</div>
      <div id="bond-skip-hint" class="bond-skip-hint hidden">
        <span id="bond-skip-msg"></span>
        <button id="bond-force-btn" class="panel-btn" title="Run bond detection anyway (may be slow)">Compute anyway</button>
      </div>
      <div id="bonds-props" class="props-list hidden"></div>
    </div>
    <div class="panel-section">
      <div class="panel-label panel-label-toggle" id="options-toggle" title="Advanced rendering options">Options &#x25B6;</div>
      <div id="options-props" class="toggle-group hidden">
        <label class="toggle" title="Render atoms and bonds as shader-computed impostors on camera-facing quads (faster, always smooth). Disable to use tessellated sphere/cylinder geometry."><input type="checkbox" id="impostor-check" checked><span>Use impostor rendering (faster)</span></label>
      </div>
    </div>
  </div>

  <div id="tooltip" class="hidden"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
