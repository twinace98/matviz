import * as vscode from 'vscode';
import { CrystalStructure, CrystalTrajectory, VolumetricData } from '../parsers/types';
import { parseStructureFileTraj } from '../parsers/index';
import { exportCif, exportPoscar } from '../parsers/exporters';
import path from 'path';

// Unified inline-SVG icon set (16×16 viewBox, 1.5px stroke, currentColor, no fill, round caps).
// Defined as raw strings so the HTML template literal can splice them directly.
const SVG_OPEN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICON = {
  home:       SVG_OPEN + '<path d="M2 7l6-5 6 5"/><path d="M3.5 6.5V13h9V6.5"/></svg>',
  arrowUp:    SVG_OPEN + '<path d="M8 13V3"/><path d="M4 7l4-4 4 4"/></svg>',
  arrowDown:  SVG_OPEN + '<path d="M8 3v10"/><path d="M4 9l4 4 4-4"/></svg>',
  arrowLeft:  SVG_OPEN + '<path d="M13 8H3"/><path d="M7 4L3 8l4 4"/></svg>',
  arrowRight: SVG_OPEN + '<path d="M3 8h10"/><path d="M9 4l4 4-4 4"/></svg>',
  rotCCW:     SVG_OPEN + '<path d="M13 8a5 5 0 1 1-1.46-3.54"/><path d="M13 3v3h-3"/></svg>',
  rotCW:      SVG_OPEN + '<path d="M3 8a5 5 0 1 0 1.46-3.54"/><path d="M3 3v3h3"/></svg>',
  zoomIn:     SVG_OPEN + '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M5 7h4M7 5v4"/></svg>',
  zoomOut:    SVG_OPEN + '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M5 7h4"/></svg>',
  fit:        SVG_OPEN + '<path d="M2 6V2h4"/><path d="M14 6V2h-4"/><path d="M2 10v4h4"/><path d="M14 10v4h-4"/></svg>',
  camera:     SVG_OPEN + '<path d="M2 5h2.5l1-1.5h5l1 1.5H14v8H2z"/><circle cx="8" cy="9" r="2.5"/></svg>',
  doc:        SVG_OPEN + '<path d="M4 2h6l3 3v9H4z"/><path d="M10 2v3h3"/><path d="M6 8h5M6 11h5"/></svg>',
  moon:       SVG_OPEN + '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>',
  sun:        SVG_OPEN + '<circle cx="8" cy="8" r="2.8"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.1 1.1M11.15 11.15l1.1 1.1M3.75 12.25l1.1-1.1M11.15 4.85l1.1-1.1"/></svg>',
  chevL:      SVG_OPEN + '<path d="M10 3L5 8l5 5"/></svg>',
  navigate:   SVG_OPEN + '<path d="M8 2l5 6-5 6-5-6z"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/></svg>',
  measure:    SVG_OPEN + '<path d="M2 8h12"/><path d="M5 5l-3 3 3 3"/><path d="M11 5l3 3-3 3"/></svg>',
  help:       SVG_OPEN + '<circle cx="8" cy="8" r="6"/><path d="M6.2 6a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.7-.8 1.3"/><circle cx="8" cy="11.5" r=".5" fill="currentColor" stroke="none"/></svg>',
  // Small chevrons used inside the numeric stepper (10×6).
  chevUpSmall: '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 4.5L5 1.5l3.5 3"/></svg>',
  chevDnSmall: '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5L5 4.5l3.5-3"/></svg>',
};

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
    <button id="mode-navigate" class="mode-btn active" title="Navigate (click atom for info)" aria-label="Navigate">${ICON.navigate}</button>
    <button id="mode-measure" class="mode-btn" title="Measure (click 2/3/4 atoms)" aria-label="Measure">${ICON.measure}</button>
    <div class="mode-sep"></div>
    <button id="panel-toggle" class="mode-btn" title="Toggle side panel" aria-label="Toggle side panel">${ICON.chevL}</button>
    <button id="help-btn" class="mode-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${ICON.help}</button>
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
      <button id="std-orient" class="bar-btn" title="Standard orientation (c-axis up, view from a*)" aria-label="Standard orientation">${ICON.home}</button>
    </div>
    <span class="bar-sep"></span>
    <div class="bar-group" title="Step Rotation">
      <button id="rot-up" class="bar-btn" title="Rotate up" aria-label="Rotate up">${ICON.arrowUp}</button>
      <button id="rot-down" class="bar-btn" title="Rotate down" aria-label="Rotate down">${ICON.arrowDown}</button>
      <button id="rot-left" class="bar-btn" title="Rotate left" aria-label="Rotate left">${ICON.arrowLeft}</button>
      <button id="rot-right" class="bar-btn" title="Rotate right" aria-label="Rotate right">${ICON.arrowRight}</button>
      <button id="rot-ccw" class="bar-btn" title="Rotate CCW" aria-label="Rotate counter-clockwise">${ICON.rotCCW}</button>
      <button id="rot-cw" class="bar-btn" title="Rotate CW" aria-label="Rotate clockwise">${ICON.rotCW}</button>
      <label class="bar-label" title="Rotation step (degrees) per arrow-button / arrow-key press">Step(&deg;):
        <span class="num-wrap" data-min="1" data-max="90">
          <input type="text" inputmode="numeric" id="step-angle" value="15" class="bar-input num-input" title="Rotation step in degrees (1–90)">
          <span class="num-steps">
            <button type="button" class="num-step up" tabindex="-1" aria-label="Increment">${ICON.chevUpSmall}</button>
            <button type="button" class="num-step dn" tabindex="-1" aria-label="Decrement">${ICON.chevDnSmall}</button>
          </span>
        </span>
      </label>
    </div>
    <span class="bar-sep"></span>
    <div class="bar-group" title="Zoom">
      <button id="zoom-in" class="bar-btn" title="Zoom in" aria-label="Zoom in">${ICON.zoomIn}</button>
      <button id="zoom-out" class="bar-btn" title="Zoom out" aria-label="Zoom out">${ICON.zoomOut}</button>
      <button id="zoom-fit" class="bar-btn" title="Fit to view" aria-label="Fit to view">${ICON.fit}</button>
      <label class="bar-label" title="Zoom step (percent) per zoom-button press or wheel tick">Step(%):
        <span class="num-wrap" data-min="1" data-max="50">
          <input type="text" inputmode="numeric" id="step-zoom" value="10" class="bar-input num-input" title="Zoom step in percent (1–50)">
          <span class="num-steps">
            <button type="button" class="num-step up" tabindex="-1" aria-label="Increment">${ICON.chevUpSmall}</button>
            <button type="button" class="num-step dn" tabindex="-1" aria-label="Decrement">${ICON.chevDnSmall}</button>
          </span>
        </span>
      </label>
    </div>
    <span class="bar-sep"></span>
    <div class="bar-group">
      <button id="screenshot-btn" class="bar-btn" title="Screenshot" aria-label="Screenshot">${ICON.camera}</button>
      <button id="text-toggle" class="bar-btn" title="Toggle raw text view" aria-label="Toggle raw text">${ICON.doc}</button>
      <button id="palette-toggle" class="bar-btn" title="Color palette: Dark" aria-label="Color palette">${ICON.moon}</button>
    </div>
  </div>

  <!-- Left sidebar controls (V2 floating glass; offset/overlay toggle removed — overlay-only) -->
  <div id="side-panel">
    <div id="panel-resize"></div>
    <div class="panel-scroll">
    <div class="panel-section">
      <div class="panel-label">Style</div>
      <div class="chips" id="display-style-chips" title="Rendering style for atoms and bonds (1-4 keys)">
        <button class="chip active" data-style="ball-and-stick" title="Atoms as spheres, bonds as split-color cylinders (1)">Ball &amp; Stick</button>
        <button class="chip" data-style="space-filling" title="Atoms at full van der Waals radius, no bonds (2)">Space-filling</button>
        <button class="chip" data-style="stick" title="Bonds only, atoms shrunk to stick radius (3)">Stick</button>
        <button class="chip" data-style="wireframe" title="Lines only (4)">Wireframe</button>
      </div>
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
        <div class="sc">
          <div class="sc-l">a</div>
          <div class="sc-steppers">
            <button type="button" class="sc-dec" data-target="sc-a" tabindex="-1" aria-label="Decrement a">&minus;</button>
            <input type="text" inputmode="numeric" id="sc-a" value="1" class="sc-val" data-axis-min="1" title="Supercell repeats along a (≥1)">
            <button type="button" class="sc-inc" data-target="sc-a" tabindex="-1" aria-label="Increment a">+</button>
          </div>
        </div>
        <div class="sc">
          <div class="sc-l">b</div>
          <div class="sc-steppers">
            <button type="button" class="sc-dec" data-target="sc-b" tabindex="-1" aria-label="Decrement b">&minus;</button>
            <input type="text" inputmode="numeric" id="sc-b" value="1" class="sc-val" data-axis-min="1" title="Supercell repeats along b (≥1)">
            <button type="button" class="sc-inc" data-target="sc-b" tabindex="-1" aria-label="Increment b">+</button>
          </div>
        </div>
        <div class="sc">
          <div class="sc-l">c</div>
          <div class="sc-steppers">
            <button type="button" class="sc-dec" data-target="sc-c" tabindex="-1" aria-label="Decrement c">&minus;</button>
            <input type="text" inputmode="numeric" id="sc-c" value="1" class="sc-val" data-axis-min="1" title="Supercell repeats along c (≥1)">
            <button type="button" class="sc-inc" data-target="sc-c" tabindex="-1" aria-label="Increment c">+</button>
          </div>
        </div>
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
    </div><!-- /.panel-scroll -->
  </div>

  <!-- Bottom-left info pill (V2 canonical formula readout — always visible) -->
  <div id="info-pill" class="hidden">
    <span id="pill-formula"></span>
    <span id="pill-meta"></span>
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
