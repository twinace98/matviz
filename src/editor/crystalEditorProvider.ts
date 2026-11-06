import * as vscode from 'vscode';
import { CrystalStructure, CrystalTrajectory, VolumetricData } from '../parsers/types';
import { parseStructureFileTraj, parseStructureFileTrajFromBytes, hasBytePath } from '../parsers/index';
import { exportCif, exportPoscar } from '../parsers/exporters';
import { parseVolumetricStream } from '../parsers/volumetricStream';
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
  rotCCW:     SVG_OPEN + '<path d="M3 8a5 5 0 1 0 1.46-3.54"/><path d="M3 3v3h3"/></svg>',
  rotCW:      SVG_OPEN + '<path d="M13 8a5 5 0 1 1-1.46-3.54"/><path d="M13 3v3h-3"/></svg>',
  zoomIn:     SVG_OPEN + '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M5 7h4M7 5v4"/></svg>',
  zoomOut:    SVG_OPEN + '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M5 7h4"/></svg>',
  fit:        SVG_OPEN + '<path d="M2 6V2h4"/><path d="M14 6V2h-4"/><path d="M2 10v4h4"/><path d="M14 10v4h-4"/></svg>',
  camera:     SVG_OPEN + '<path d="M2 5h2.5l1-1.5h5l1 1.5H14v8H2z"/><circle cx="8" cy="9" r="2.5"/></svg>',
  doc:        SVG_OPEN + '<path d="M4 2h6l3 3v9H4z"/><path d="M10 2v3h3"/><path d="M6 8h5M6 11h5"/></svg>',
  moon:       SVG_OPEN + '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>',
  sun:        SVG_OPEN + '<circle cx="8" cy="8" r="2.8"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.1 1.1M11.15 11.15l1.1 1.1M3.75 12.25l1.1-1.1M11.15 4.85l1.1-1.1"/></svg>',
  chevL:      SVG_OPEN + '<path d="M10 3L5 8l5 5"/></svg>',
  close:      SVG_OPEN + '<path d="M4 4l8 8M12 4l-8 8"/></svg>',
  navigate:   SVG_OPEN + '<path d="M8 2l5 6-5 6-5-6z"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/></svg>',
  measure:    SVG_OPEN + '<path d="M2 8h12"/><path d="M5 5l-3 3 3 3"/><path d="M11 5l3 3-3 3"/></svg>',
  help:       SVG_OPEN + '<circle cx="8" cy="8" r="6"/><path d="M6.2 6a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.7-.8 1.3"/><circle cx="8" cy="11.5" r=".5" fill="currentColor" stroke="none"/></svg>',
  // Small chevrons used inside the numeric stepper (10×6).
  chevUpSmall: '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 4.5L5 1.5l3.5 3"/></svg>',
  chevDnSmall: '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5L5 4.5l3.5-3"/></svg>',
};

// CustomTextEditorProvider — text buffer (vscode.TextDocument) and webview
// share one document, so VSCode's standard dirty state, save dialog, and
// onDidChangeTextDocument events flow through automatically. Edits in the
// companion text pane reflow the 3D view via a debounced reparse
// (~250 ms after the last keystroke); parseSeq drops stale parses on fast
// typing.

interface ParsedContent {
  uri: vscode.Uri;
  trajectory: CrystalTrajectory;
  // v0.23 multi-grid: `volumetrics` is the canonical list posted to the
  // webview; `volumetric` kept for export/info convenience === [0].
  volumetric?: VolumetricData;
  volumetrics?: VolumetricData[];
  // First-frame convenience for export / info display.
  structure: CrystalStructure;
  // v0.22 Tier 2: when true, the content was loaded via the raw-byte parser
  // because the file exceeds the TextDocument.getText() ceiling. The
  // text-buffer reparse loop is disabled in this mode (rereading a 1+ GB
  // file on every keystroke is untenable, and VSCode disables most text
  // editing at this size anyway).
  usedRawBytePath?: boolean;
}

const PARSE_DEBOUNCE_MS = 250;

/**
 * v0.22 Tier 2 threshold. Files of this size or larger with a volumetric
 * extension bypass `TextDocument.getText()` entirely and stream-parse
 * from `vscode.workspace.fs.readFile`. Chosen well below V8's
 * MAX_STRING_LENGTH (~512 MiB) to leave safety margin for UTF-8 expansion.
 */
const RAW_BYTE_THRESHOLD = 256 * 1024 * 1024;

export class CrystalEditorProvider implements vscode.CustomTextEditorProvider {
  private activeWebview: vscode.Webview | undefined;
  private activeContent: ParsedContent | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async exportStructure(format: 'cif' | 'poscar') {
    if (!this.activeContent) {
      vscode.window.showWarningMessage('No structure open to export.');
      return;
    }
    const content = format === 'cif'
      ? exportCif(this.activeContent.structure)
      : exportPoscar(this.activeContent.structure);
    const ext = format === 'cif' ? 'cif' : 'poscar';
    const uri = await vscode.window.showSaveDialog({
      filters: { [format.toUpperCase()]: [ext] },
      defaultUri: vscode.Uri.file(
        this.activeContent.uri.fsPath.replace(/\.[^.]+$/, `.${ext}`)
      ),
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  }

  /**
   * Parse the current text-buffer contents into a `ParsedContent`. Returns
   * null on parse failure (caller decides whether to surface a toast or
   * silently drop a stale-edit reparse).
   */
  private parseDocument(document: vscode.TextDocument): ParsedContent | null {
    const filename = path.basename(document.uri.fsPath);
    // v0.22 Tier 3: read on every parse so toggling the setting in
    // settings.json takes effect at the next reparse without reloading.
    const userCap = vscode.workspace.getConfiguration('matviz.volumetric').get<number | null>('maxGridPoints', null);
    try {
      const result = parseStructureFileTraj(document.getText(), filename, { maxGridPoints: userCap });
      return {
        uri: document.uri,
        trajectory: result.trajectory,
        volumetric: result.volumetric,
        volumetrics: result.volumetrics,
        structure: result.trajectory.frames[0],
      };
    } catch {
      return null;
    }
  }

  /**
   * v0.22 Tier 2: initial parse that picks between the TextDocument path
   * and the raw-byte path based on file size + volumetric extension. Only
   * used at editor open — reparse-on-edit uses `parseDocument` and is
   * suppressed entirely for raw-byte loads.
   */
  private async parseDocumentInitial(document: vscode.TextDocument): Promise<ParsedContent | null | 'cancelled'> {
    const filename = path.basename(document.uri.fsPath);
    if (hasBytePath(filename)) {
      try {
        const stat = await vscode.workspace.fs.stat(document.uri);
        if (stat.size >= RAW_BYTE_THRESHOLD) {
          // v0.22 Tier 3: pass user's volumetric grid-point cap into the
          // parser so it can decimate during ingestion. `null` (the default)
          // lets the parser fall back to its safety-default cap, which keeps
          // grids well under the 4 GiB ArrayBuffer ceiling.
          const userCap = vscode.workspace.getConfiguration('matviz.volumetric').get<number | null>('maxGridPoints', null);
          // v0.23.1: local files stream in chunks (no 2 GiB fs.readFile
          // limit, memory ≈ output grids); other schemes (remote / virtual
          // file systems) keep the whole-file byte path.
          const result = document.uri.scheme === 'file'
            ? await this.streamVolumetric(document.uri.fsPath, filename, userCap)
            : parseStructureFileTrajFromBytes(await vscode.workspace.fs.readFile(document.uri), filename, { maxGridPoints: userCap });
          return {
            uri: document.uri,
            trajectory: result.trajectory,
            volumetric: result.volumetric,
            volumetrics: result.volumetrics,
            structure: result.trajectory.frames[0],
            usedRawBytePath: true,
          };
        }
      } catch (err) {
        // A cancelled stream must not fall through: reading a multi-GB file
        // via TextDocument is exactly what the user just stopped.
        if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
        // Otherwise fall through to the synchronous TextDocument path. If
        // that also fails the caller will surface the parse-error toast.
      }
    }
    return this.parseDocument(document);
  }

  /** v0.23.1: chunked streaming load with a cancellable progress notification. */
  private streamVolumetric(fsPath: string, filename: string, maxGridPoints: number | null) {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `MatViz: loading ${filename}`,
      cancellable: true,
    }, async (progress, token) => {
      const ac = new AbortController();
      token.onCancellationRequested(() => ac.abort());
      let lastPct = 0;
      return parseVolumetricStream(fsPath, filename, {
        maxGridPoints,
        signal: ac.signal,
        onProgress: (read, total) => {
          const pct = Math.floor((100 * read) / total);
          if (pct > lastPct) {
            progress.report({ increment: pct - lastPct, message: `${(read / 2 ** 30).toFixed(2)} / ${(total / 2 ** 30).toFixed(2)} GiB` });
            lastPct = pct;
          }
        },
      });
    });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Initial parse. On failure, show an actionable toast — the webview
    // still mounts but with no structure loaded; the user can dismiss and
    // edit the file in the companion text pane (which is what they see
    // first via "Open in MatViz" → split pane). v0.22 Tier 2:
    // `parseDocumentInitial` is async because oversize volumetric files
    // (>256 MiB) bypass TextDocument and stream-parse from raw bytes.
    const initial = await this.parseDocumentInitial(document);
    let content = initial === 'cancelled' ? null : initial;
    if (initial === 'cancelled') {
      vscode.window.showInformationMessage(`MatViz: loading ${path.basename(document.uri.fsPath)} was cancelled.`);
    } else if (!content) {
      const filename = path.basename(document.uri.fsPath);
      vscode.window.showErrorMessage(
        `MatViz could not parse ${filename}. Open the file in the text editor to inspect it.`,
        'Open as Text'
      ).then(choice => {
        if (choice === 'Open as Text') {
          vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
        }
      });
    }

    this.activeWebview = webviewPanel.webview;
    if (content) this.activeContent = content;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    // Read user-configurable defaults from VSCode settings and bake them
    // into the HTML page (`window.MATVIZ_DEFAULTS`) so the webview's
    // renderer can pick them up BEFORE `vscode.setState` restoreState runs:
    // settings provide initial defaults, localStorage state wins on return
    // visits to the same URI.
    const cfg = vscode.workspace.getConfiguration('matviz.defaults');
    const defaults = {
      style: cfg.get<string>('style', 'ball-and-stick'),
      palette: cfg.get<string>('palette', 'dark'),
      showBonds: cfg.get<boolean>('showBonds', true),
      showBoundary: cfg.get<boolean>('showBoundary', true),
      cameraMode: cfg.get<string>('cameraMode', 'orthographic'),
      bondCutoffPad: cfg.get<number>('bondCutoffPad', 0.3),
      axisIndicatorSize: cfg.get<number>('axisIndicatorSize', 80),
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, defaults);

    // Post the current parsed content into the webview, splitting
    // single-frame vs trajectory load paths. No-op if `content` is null.
    const postContentToWebview = (c: ParsedContent | null) => {
      if (!c) return;
      if (c.trajectory.frames.length > 1) {
        webviewPanel.webview.postMessage({ type: 'loadTrajectory', data: c.trajectory });
      } else {
        webviewPanel.webview.postMessage({ type: 'loadStructure', data: c.structure });
      }
      // v0.23: post the full named-grid list. `volumetrics` is always
      // populated by the parser layer (attachGridList) when any grid
      // exists; fall back to the single `volumetric` for defensiveness.
      const grids = c.volumetrics ?? (c.volumetric ? [c.volumetric] : []);
      if (grids.length > 0) {
        webviewPanel.webview.postMessage({
          type: 'loadVolumetrics',
          data: grids.map(g => ({
            origin: g.origin,
            lattice: g.lattice,
            dims: g.dims,
            data: g.data,
            stride: g.stride,
            originalDims: g.originalDims,
            name: g.name,
            kind: g.kind,
          })),
        });
      }
    };

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') {
        postContentToWebview(content);
      }
      if (msg.type === 'openAsText') {
        vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      }
      // Add-phase via side-panel button (webview-initiated; no command
      // palette round-trip needed).
      if (msg.type === 'addPhaseRequest') {
        vscode.commands.executeCommand('matviz.addPhase');
      }
      // Compare-to-phase failure → vscode toast.
      if (msg.type === 'comparisonResult') {
        const r = msg as { type: 'comparisonResult'; ok: boolean; reason?: string };
        if (!r.ok && r.reason) {
          vscode.window.showWarningMessage(`MatViz: ${r.reason}`);
        }
      }
    });

    // Debounced reparse on text-buffer change. parseSeq drops stale results
    // so rapid typing during a slow parse doesn't produce out-of-order
    // updates. Filters to the document this editor is viewing (multiple
    // matviz tabs each subscribe independently).
    let parseSeq = 0;
    let timer: NodeJS.Timeout | null = null;
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      // v0.22 Tier 2: raw-byte-loaded content (huge volumetric files) is
      // not backed by a meaningful TextDocument view — rereading the
      // 1+ GB file on every keystroke is untenable, and VSCode's
      // largeFileOptimizations already disables most editing affordances
      // at that size. Skip the reparse loop entirely for these documents.
      if (content?.usedRawBytePath) return;
      if (timer) clearTimeout(timer);
      const seq = ++parseSeq;
      timer = setTimeout(() => {
        if (seq !== parseSeq) return;
        const next = this.parseDocument(document);
        if (!next) {
          // Parse failure during edit — keep showing the last good state.
          return;
        }
        if (seq !== parseSeq) return;
        content = next;
        if (webviewPanel.active || this.activeWebview === webviewPanel.webview) {
          this.activeContent = next;
        }
        postContentToWebview(next);
      }, PARSE_DEBOUNCE_MS);
    });

    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.visible) {
        this.activeWebview = webviewPanel.webview;
        if (content) this.activeContent = content;
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      if (timer) clearTimeout(timer);
      if (this.activeWebview === webviewPanel.webview) {
        this.activeWebview = undefined;
        this.activeContent = undefined;
      }
    });
  }

  postMessageToActive(message: unknown) {
    this.activeWebview?.postMessage(message);
  }

  private getHtml(webview: vscode.Webview, defaults: object): string {
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
        <span id="help-title">Shortcuts<span class="help-sub">press <kbd>?</kbd> anytime</span></span>
        <button id="help-close" class="bar-btn" title="Close (Esc)" aria-label="Close">${ICON.close}</button>
      </div>
      <div id="help-body">
        <div class="help-col">
          <div class="help-h">Rotation</div>
          <div class="help-row"><span class="help-keys"><kbd>&#x2190;</kbd><kbd>&#x2193;</kbd><kbd>&#x2191;</kbd><kbd>&#x2192;</kbd></span><span>Rotate by step</span></div>
          <div class="help-row"><span class="help-keys"><kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd></span><span>Vim rotate</span></div>
          <div class="help-row"><span class="help-keys"><kbd>[</kbd><kbd>]</kbd></span><span>Rotate CCW / CW</span></div>
          <div class="help-row"><span class="help-keys"><kbd>&#x21E7;</kbd>+key</span><span>1&deg; fine step</span></div>
          <div class="help-row"><span class="help-keys"><kbd>+</kbd><kbd>&minus;</kbd></span><span>Zoom in / out</span></div>
        </div>
        <div class="help-col">
          <div class="help-h">Navigation</div>
          <div class="help-row"><span class="help-keys">Left drag</span><span>Rotate</span></div>
          <div class="help-row"><span class="help-keys">Right drag</span><span>Pan</span></div>
          <div class="help-row"><span class="help-keys">Wheel</span><span>Zoom</span></div>
          <div class="help-row"><span class="help-keys">Click atom</span><span>Select / info</span></div>
        </div>
        <div class="help-col">
          <div class="help-h">Style</div>
          <div class="help-row"><span class="help-keys"><kbd>1</kbd></span><span>Ball &amp; Stick</span></div>
          <div class="help-row"><span class="help-keys"><kbd>2</kbd></span><span>Space-filling</span></div>
          <div class="help-row"><span class="help-keys"><kbd>3</kbd></span><span>Stick</span></div>
          <div class="help-row"><span class="help-keys"><kbd>4</kbd></span><span>Wireframe</span></div>
        </div>
        <div class="help-col">
          <div class="help-h">Mode</div>
          <div class="help-row"><span class="help-keys"><kbd>?</kbd></span><span>This help</span></div>
          <div class="help-row"><span class="help-keys"><kbd>Esc</kbd></span><span>Clear selection / close help</span></div>
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

  <!-- Left sidebar controls -->
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
    <div class="panel-section hidden" id="grid-section">
      <div class="panel-label" title="Select which volumetric grid to display — CHGCAR charge/magnetization/spin, or multiple XSF datagrids">Grid</div>
      <select id="grid-select" class="panel-select" title="Active volumetric grid"></select>
    </div>
    <div class="panel-section hidden" id="iso-section">
      <div class="panel-label" title="Isosurface contour level for the loaded volumetric data">Iso-level</div>
      <div class="iso-row">
        <input type="range" id="iso-slider" class="iso-slider" min="0" max="1" step="0.001" value="0" title="Drag to change isosurface level (absolute value; negative lobe drawn automatically)">
        <input type="number" id="iso-input" class="iso-num" step="any" value="0" title="Isosurface level (numeric entry)">
      </div>
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
      <div class="panel-label panel-label-toggle" id="phases-toggle" title="Secondary structures overlaid alongside the primary (formerly Phases). Click to expand.">Overlay &#x25B6;</div>
      <div id="phases-content" class="hidden">
        <div id="phases-list"></div>
        <button id="add-phase-btn" class="panel-btn full-width" title="Add a structure file to overlay">+ Add Overlay&hellip;</button>
        <div class="toggle-group" id="comparison-row">
          <label class="toggle" title="Display NN displacement arrows from primary atoms to first secondary phase atoms (Viridis colormap)"><input type="checkbox" id="compare-toggle"><span>Compare to first overlay (displacement arrows)</span></label>
        </div>
        <div id="comparison-stats" class="comparison-stats hidden"></div>
      </div>
    </div>
    <div class="panel-section hidden" id="atom-vectors-section">
      <div class="panel-label" title="Per-atom vector overlay (magnetic moments, forces, velocities, displacements). Auto-detected from MAGMOM tags, XSF trailing columns, extended-XYZ Properties, or CIF _atom_site_moment_*.">Vectors</div>
      <div class="vec-kind-label" id="vec-kind-label"></div>
      <div class="toggle-group">
        <label class="toggle" title="Render arrows on atoms with non-zero vector data (length ∝ |v|, color by colormap)"><input type="checkbox" id="vector-check"><span>Show arrows</span></label>
      </div>
      <div class="toggle-group" id="vector-colormap-row" title="Colormap for arrow color">
        <label class="toggle"><input type="radio" name="vec-colormap" value="redblue" id="vec-cmap-redblue" checked><span>Red/Blue</span></label>
        <label class="toggle"><input type="radio" name="vec-colormap" value="viridis" id="vec-cmap-viridis"><span>Viridis</span></label>
        <label class="toggle"><input type="radio" name="vec-colormap" value="single" id="vec-cmap-single"><span>Single</span></label>
      </div>
      <div class="iso-row" title="Arrow length scale (Å per unit-magnitude vector). 1.0 = 1 Å arrow per μB / per eV·Å⁻¹.">
        <span class="iso-row-k">Scale</span>
        <input type="range" id="vec-scale-slider" class="iso-slider" min="0.1" max="50" step="0.1" value="1.0">
        <input type="text" inputmode="decimal" id="vec-scale-num" class="iso-num" data-min="0.1" data-max="50" data-step="0.1" data-precision="1" value="1.0">
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

  <!-- Bottom-left info pill — always visible. Picked-atom info appends as
       an extra segment after the meta when an atom is clicked. -->
  <div id="info-pill" class="hidden">
    <span id="pill-formula"></span>
    <span id="pill-meta"></span>
    <span id="pill-selected" class="hidden"></span>
  </div>

  <!-- Measure HUD (top-right; visible only in measure mode) -->
  <div id="measure-hud" class="hidden" role="region" aria-label="Measurement readout">
    <div class="measure-head">
      <div class="measure-kinds" role="tablist">
        <button type="button" class="measure-kind" data-kind="distance" role="tab" aria-selected="true">Distance</button>
        <button type="button" class="measure-kind" data-kind="angle" role="tab" disabled title="Needs 3 atoms">Angle</button>
        <button type="button" class="measure-kind" data-kind="dihedral" role="tab" disabled title="Needs 4 atoms">Dihedral</button>
      </div>
      <button type="button" id="measure-clear" class="measure-x" title="Clear (Esc)" aria-label="Clear measurement">${ICON.close}</button>
    </div>

    <div class="measure-value">
      <span class="measure-num" id="measure-num">&mdash;</span>
      <span class="measure-unit" id="measure-unit">&Aring;</span>
    </div>

    <div class="measure-pair" id="measure-pair"></div>

    <div class="measure-delta hidden" id="measure-delta">
      <div class="measure-delta-row">
        <span class="measure-delta-k">&Delta; fractional</span>
        <span class="measure-delta-v" id="measure-delta-frac"></span>
      </div>
      <div class="measure-delta-row">
        <span class="measure-delta-k">&Delta; cartesian</span>
        <span class="measure-delta-v" id="measure-delta-cart"></span>
      </div>
    </div>

    <div class="measure-foot">
      <span class="measure-hint" id="measure-hint">Click an atom to start measuring.</span>
      <button type="button" id="measure-copy" class="measure-copy" title="Copy measurement">Copy</button>
    </div>
  </div>

  <div id="tooltip" class="hidden"></div>
  <script nonce="${nonce}">window.MATVIZ_DEFAULTS = ${JSON.stringify(defaults)};</script>
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
