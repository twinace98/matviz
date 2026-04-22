import { CrystalRenderer } from './renderer';
import { ExtensionMessage, DisplayStyle, CameraMode } from './message';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLDivElement;
const tooltip = document.getElementById('tooltip') as HTMLDivElement;

// --- Adaptive top-bar height ---
const topBar = document.getElementById('top-bar');
if (topBar) {
  const syncTopBarHeight = () => {
    const h = Math.ceil(topBar.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--top-bar-h', `${h}px`);
  };
  syncTopBarHeight();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncTopBarHeight).observe(topBar);
  } else {
    window.addEventListener('resize', syncTopBarHeight);
  }
}

const renderer = new CrystalRenderer(canvas);

// --- Side panel toggle ---
const panelToggle = document.getElementById('panel-toggle') as HTMLButtonElement;
const sidePanel = document.getElementById('side-panel') as HTMLDivElement;

// --- Layout mode (offset vs overlay) ---
type LayoutMode = 'offset' | 'overlay';
const layoutOffsetBtn = document.getElementById('layout-offset-btn') as HTMLButtonElement | null;
const layoutOverlayBtn = document.getElementById('layout-overlay-btn') as HTMLButtonElement | null;
const MODE_BAR_WIDTH = 40;

function updateLayoutOffsetVar() {
  // Offset from viewport-left to the canvas' left edge when layout-offset is active.
  const collapsed = sidePanel.classList.contains('collapsed');
  const panelWidth = collapsed ? 0 : sidePanel.getBoundingClientRect().width;
  const offset = MODE_BAR_WIDTH + panelWidth;
  document.documentElement.style.setProperty('--layout-offset-left', `${offset}px`);
}

function applyLayoutMode(mode: LayoutMode) {
  document.body.classList.toggle('layout-offset', mode === 'offset');
  layoutOffsetBtn?.classList.toggle('active', mode === 'offset');
  layoutOverlayBtn?.classList.toggle('active', mode === 'overlay');
  updateLayoutOffsetVar();
}

// Default offset per v0.14 decision; overlay path preserved and toggle-reachable.
let layoutMode: LayoutMode = 'offset';
function setLayoutMode(mode: LayoutMode) {
  layoutMode = mode;
  applyLayoutMode(mode);
  debouncedSave();
}
applyLayoutMode('offset');

layoutOffsetBtn?.addEventListener('click', () => setLayoutMode('offset'));
layoutOverlayBtn?.addEventListener('click', () => setLayoutMode('overlay'));

if (panelToggle && sidePanel) {
  panelToggle.addEventListener('click', () => {
    const collapsed = sidePanel.classList.toggle('collapsed');
    panelToggle.innerHTML = collapsed ? '&#x25B6;' : '&#x25C0;';
    panelToggle.title = collapsed ? 'Show side panel' : 'Hide side panel';
    updateLayoutOffsetVar();
    debouncedSave();
  });
}

// --- Side panel resize ---
const panelResize = document.getElementById('panel-resize') as HTMLDivElement;

if (panelResize && sidePanel) {
  let resizing = false;
  panelResize.addEventListener('pointerdown', (e) => {
    resizing = true;
    panelResize.classList.add('dragging');
    panelResize.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const newWidth = Math.max(140, Math.min(400, e.clientX - MODE_BAR_WIDTH));
    sidePanel.style.width = newWidth + 'px';
    updateLayoutOffsetVar();
  });
  window.addEventListener('pointerup', () => {
    if (resizing) debouncedSave();
    resizing = false;
    panelResize.classList.remove('dragging');
  });
}

// --- Side panel controls ---

// Supercell
const scA = document.getElementById('sc-a') as HTMLInputElement;
const scB = document.getElementById('sc-b') as HTMLInputElement;
const scC = document.getElementById('sc-c') as HTMLInputElement;
function updateSupercell() {
  renderer.setSupercell([parseInt(scA.value) || 1, parseInt(scB.value) || 1, parseInt(scC.value) || 1]);
}
scA.addEventListener('change', updateSupercell);
scB.addEventListener('change', updateSupercell);
scC.addEventListener('change', updateSupercell);

// Display style
const styleSelect = document.getElementById('display-style') as HTMLSelectElement;
if (styleSelect) {
  styleSelect.addEventListener('change', () => renderer.setDisplayStyle(styleSelect.value as DisplayStyle));
}

// Sphere impostor (inside Options section)
const impostorCheck = document.getElementById('impostor-check') as HTMLInputElement;
if (impostorCheck) {
  impostorCheck.addEventListener('change', () => renderer.setImpostorEnabled(impostorCheck.checked));
}

// 16.1 Thermal ellipsoids (hidden until structure with thermalAniso loads)
const ellipsoidsCheck = document.getElementById('ellipsoids-check') as HTMLInputElement;
const ellipsoidContour50 = document.getElementById('ellipsoid-contour-50') as HTMLInputElement;
const ellipsoidContour90 = document.getElementById('ellipsoid-contour-90') as HTMLInputElement;
if (ellipsoidsCheck) {
  ellipsoidsCheck.addEventListener('change', () => renderer.setShowEllipsoids(ellipsoidsCheck.checked));
}
if (ellipsoidContour50) {
  ellipsoidContour50.addEventListener('change', () => { if (ellipsoidContour50.checked) renderer.setProbabilityContour(0.5); });
}
if (ellipsoidContour90) {
  ellipsoidContour90.addEventListener('change', () => { if (ellipsoidContour90.checked) renderer.setProbabilityContour(0.9); });
}
function updateEllipsoidsSectionVisibility() {
  const section = document.getElementById('ellipsoids-section');
  if (!section) return;
  if (renderer.hasThermalAniso()) {
    section.classList.remove('hidden');
    if (ellipsoidsCheck) ellipsoidsCheck.checked = renderer.getShowEllipsoids();
    const c = renderer.getProbabilityContour();
    if (ellipsoidContour50) ellipsoidContour50.checked = (c === 0.5);
    if (ellipsoidContour90) ellipsoidContour90.checked = (c === 0.9);
  } else {
    section.classList.add('hidden');
  }
}

// 16.2 Partial occupancy section visibility
const partialOccCheck = document.getElementById('partial-occ-check') as HTMLInputElement;
if (partialOccCheck) {
  partialOccCheck.addEventListener('change', () => renderer.setShowPartialOccupancy(partialOccCheck.checked));
}
function updatePartialOccupancySectionVisibility() {
  const section = document.getElementById('partial-occupancy-section');
  if (!section) return;
  if (renderer.hasPartialOccupancy()) {
    section.classList.remove('hidden');
    if (partialOccCheck) partialOccCheck.checked = renderer.getShowPartialOccupancy();
  } else {
    section.classList.add('hidden');
  }
}

// 16.3 Magnetic moments
const magmomCheck = document.getElementById('magmom-check') as HTMLInputElement;
const magCmapRedblue = document.getElementById('mag-cmap-redblue') as HTMLInputElement;
const magCmapViridis = document.getElementById('mag-cmap-viridis') as HTMLInputElement;
if (magmomCheck) {
  magmomCheck.addEventListener('change', () => renderer.setShowMagneticMoments(magmomCheck.checked));
}
if (magCmapRedblue) {
  magCmapRedblue.addEventListener('change', () => { if (magCmapRedblue.checked) renderer.setMagneticColormap('redblue'); });
}
if (magCmapViridis) {
  magCmapViridis.addEventListener('change', () => { if (magCmapViridis.checked) renderer.setMagneticColormap('viridis'); });
}
function updateMagneticMomentsSectionVisibility() {
  const section = document.getElementById('magnetic-moments-section');
  if (!section) return;
  if (renderer.hasMagneticMoments()) {
    section.classList.remove('hidden');
    if (magmomCheck) magmomCheck.checked = renderer.getShowMagneticMoments();
    const cmap = renderer.getMagneticColormap();
    if (magCmapRedblue) magCmapRedblue.checked = (cmap === 'redblue');
    if (magCmapViridis) magCmapViridis.checked = (cmap === 'viridis');
  } else {
    section.classList.add('hidden');
  }
}

// Camera toggle
const cameraBtn = document.getElementById('camera-toggle') as HTMLButtonElement;
if (cameraBtn) {
  cameraBtn.addEventListener('click', () => {
    const mode: CameraMode = renderer.getCameraMode() === 'orthographic' ? 'perspective' : 'orthographic';
    renderer.setCameraMode(mode);
    cameraBtn.textContent = mode === 'orthographic' ? 'Ortho' : 'Persp';
    cameraBtn.classList.toggle('active', mode === 'orthographic');
  });
}

// Palette toggle (top bar icon)
const paletteBtn = document.getElementById('palette-toggle') as HTMLButtonElement;
if (paletteBtn) {
  paletteBtn.addEventListener('click', () => {
    const next = renderer.getColorPalette() === 'dark' ? 'light' : 'dark';
    renderer.setColorPalette(next);
    paletteBtn.textContent = next === 'dark' ? '\u263E' : '\u2600';
    paletteBtn.title = next === 'dark' ? 'Color palette: Dark' : 'Color palette: Light';
    paletteBtn.classList.toggle('active', next === 'dark');
  });
}

// Visibility checkboxes
const bondsCheck = document.getElementById('bonds-check') as HTMLInputElement;
const labelsCheck = document.getElementById('labels-check') as HTMLInputElement;
const polyCheck = document.getElementById('poly-check') as HTMLInputElement;

const boundaryCheck = document.getElementById('boundary-check') as HTMLInputElement;

if (bondsCheck) bondsCheck.addEventListener('change', () => renderer.toggleBonds());
if (labelsCheck) labelsCheck.addEventListener('change', () => renderer.toggleLabels());
if (polyCheck) polyCheck.addEventListener('change', () => {
  renderer.togglePolyhedra();
  updatePolyCentersVisibility();
});
const celldashCheck = document.getElementById('celldash-check') as HTMLInputElement;

if (boundaryCheck) boundaryCheck.addEventListener('change', () => renderer.toggleBoundaryAtoms());
if (celldashCheck) celldashCheck.addEventListener('change', () => renderer.toggleCellDash());

// Axis indicator size
const axisSizeSlider = document.getElementById('axis-size') as HTMLInputElement;
if (axisSizeSlider) axisSizeSlider.addEventListener('input', () => renderer.setAxisIndicatorSize(parseInt(axisSizeSlider.value)));

// --- Mode bar ---
const modeNavigate = document.getElementById('mode-navigate') as HTMLButtonElement;
const modeMeasure = document.getElementById('mode-measure') as HTMLButtonElement;

function setMode(mode: 'navigate' | 'measure') {
  renderer.setInteractionMode(mode);
  modeNavigate.classList.toggle('active', mode === 'navigate');
  modeMeasure.classList.toggle('active', mode === 'measure');
  tooltip.classList.add('hidden');
}

if (modeNavigate) modeNavigate.addEventListener('click', () => setMode('navigate'));
if (modeMeasure) modeMeasure.addEventListener('click', () => setMode('measure'));

// --- Top bar controls ---

// Axis views
const axisButtons = ['a', 'b', 'c', 'a*', 'b*', 'c*'] as const;
for (const axis of axisButtons) {
  const btn = document.getElementById(`view-${axis}`) as HTMLButtonElement;
  if (btn) btn.addEventListener('click', () => renderer.viewAlongAxis(axis));
}

// Standard orientation
const stdBtn = document.getElementById('std-orient') as HTMLButtonElement;
if (stdBtn) stdBtn.addEventListener('click', () => renderer.standardOrientation());

// Step angle / zoom inputs
const stepAngleInput = document.getElementById('step-angle') as HTMLInputElement;
const stepZoomInput = document.getElementById('step-zoom') as HTMLInputElement;

function getStepAngle(): number { return parseFloat(stepAngleInput?.value) || 15; }
function getStepZoom(): number { return (parseFloat(stepZoomInput?.value) || 10) / 100; }

// Rotation buttons
const rotMap: Record<string, [number, 'x' | 'y' | 'z']> = {
  'rot-up':    [1,  'x'],
  'rot-down':  [-1, 'x'],
  'rot-left':  [1,  'y'],
  'rot-right': [-1, 'y'],
  'rot-ccw':   [-1, 'z'],
  'rot-cw':    [1,  'z'],
};
for (const [id, [sign, axis]] of Object.entries(rotMap)) {
  const btn = document.getElementById(id) as HTMLButtonElement;
  if (btn) btn.addEventListener('click', () => renderer.rotateCamera(sign * getStepAngle(), axis));
}

// Zoom buttons
const zoomInBtn = document.getElementById('zoom-in') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoom-out') as HTMLButtonElement;
const zoomFitBtn = document.getElementById('zoom-fit') as HTMLButtonElement;

if (zoomInBtn) zoomInBtn.addEventListener('click', () => renderer.zoom(1 - getStepZoom()));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => renderer.zoom(1 + getStepZoom()));
if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => renderer.resetCamera());

// Screenshot
const screenshotBtn = document.getElementById('screenshot-btn') as HTMLButtonElement;
if (screenshotBtn) {
  screenshotBtn.addEventListener('click', () => {
    const dataUrl = renderer.exportScreenshot(2);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'crystal_screenshot.png';
    link.click();
  });
}

// Open as text
const textToggle = document.getElementById('text-toggle') as HTMLButtonElement;
if (textToggle) {
  textToggle.addEventListener('click', () => {
    vscode.postMessage({ type: 'openAsText' });
  });
}

// --- Help overlay ---
const helpOverlay = document.getElementById('help-overlay');
const helpBtn = document.getElementById('help-btn');
const helpClose = document.getElementById('help-close');
function showHelp() { helpOverlay?.classList.remove('hidden'); }
function hideHelp() { helpOverlay?.classList.add('hidden'); }
helpBtn?.addEventListener('click', showHelp);
helpClose?.addEventListener('click', hideHelp);
helpOverlay?.addEventListener('click', (e) => { if (e.target === helpOverlay) hideHelp(); });

// --- Keyboard controls ---
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  // Skip while IME (e.g. Korean Hangul) is composing — those keypresses belong to the IME.
  if (e.isComposing || e.keyCode === 229) return;
  if (e.code === 'Slash' && e.shiftKey) { showHelp(); e.preventDefault(); return; }
  const step = e.shiftKey ? 1 : getStepAngle();
  // Use e.code where possible so Shift-modified / IME-mapped keys still register.
  switch (e.code) {
    case 'ArrowUp':      case 'KeyK': renderer.rotateCamera(step,  'x'); e.preventDefault(); return;
    case 'ArrowDown':    case 'KeyJ': renderer.rotateCamera(-step, 'x'); e.preventDefault(); return;
    case 'ArrowLeft':    case 'KeyH': renderer.rotateCamera(step,  'y'); e.preventDefault(); return;
    case 'ArrowRight':   case 'KeyL': renderer.rotateCamera(-step, 'y'); e.preventDefault(); return;
    case 'BracketLeft':  renderer.rotateCamera(-step, 'z'); e.preventDefault(); return;
    case 'BracketRight': renderer.rotateCamera(step,  'z'); e.preventDefault(); return;
    case 'Minus':        renderer.zoom(1 + getStepZoom()); e.preventDefault(); return;
    case 'Equal':        renderer.zoom(1 - getStepZoom()); e.preventDefault(); return;
    case 'Escape':
      if (helpOverlay && !helpOverlay.classList.contains('hidden')) { hideHelp(); return; }
      renderer.clearSelection();
      renderer.clearMeasurements();
      tooltip.classList.add('hidden');
      return;
  }
});

// --- Picking callbacks ---
renderer.setAtomSelectCallback((data) => {
  if (data) {
    tooltip.classList.remove('hidden');
    tooltip.style.left = '250px';
    tooltip.style.bottom = '8px';
    tooltip.style.top = 'auto';
    const f = data.fractional;
    tooltip.innerHTML = `<b>${data.element}</b> #${data.index}<br>` +
      `Cart: (${data.cartesian[0].toFixed(3)}, ${data.cartesian[1].toFixed(3)}, ${data.cartesian[2].toFixed(3)})<br>` +
      `Frac: (${f[0].toFixed(4)}, ${f[1].toFixed(4)}, ${f[2].toFixed(4)})`;
    vscode.postMessage({ type: 'atomSelected', data });
  } else {
    tooltip.classList.add('hidden');
  }
});

renderer.setMeasurementCallback((data) => {
  const unit = data.type === 'distance' ? ' \u00C5' : '\u00B0';
  tooltip.classList.remove('hidden');
  tooltip.innerHTML += `<br>${data.type}: ${data.value.toFixed(3)}${unit}`;
  vscode.postMessage({ type: 'measurement', data });
});

// --- Theme ---
const mq = window.matchMedia('(prefers-color-scheme: dark)');
mq.addEventListener('change', () => renderer.updateTheme());
new MutationObserver(() => renderer.updateTheme())
  .observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });

// --- State persistence ---
type PersistedState = ReturnType<typeof renderer.getState> & {
  layoutMode?: LayoutMode;
  panelCollapsed?: boolean;
  panelWidth?: number;
  stepAngle?: number;
  stepZoom?: number;
};
function saveState() {
  const s = renderer.getState() as PersistedState;
  s.layoutMode = layoutMode;
  s.panelCollapsed = sidePanel.classList.contains('collapsed');
  s.panelWidth = sidePanel.getBoundingClientRect().width;
  s.stepAngle = parseFloat(stepAngleInput?.value) || 15;
  s.stepZoom = parseFloat(stepZoomInput?.value) || 10;
  vscode.setState(s);
}
const debouncedSave = debounce(saveState, 300);
window.addEventListener('pointerup', debouncedSave);
window.addEventListener('wheel', debouncedSave);
[scA, scB, scC, styleSelect, impostorCheck, stepAngleInput, stepZoomInput,
  bondsCheck, labelsCheck, polyCheck, boundaryCheck, celldashCheck, axisSizeSlider,
  ellipsoidsCheck, ellipsoidContour50, ellipsoidContour90, partialOccCheck,
  magmomCheck, magCmapRedblue, magCmapViridis]
  .forEach((el) => el?.addEventListener('change', debouncedSave));
cameraBtn?.addEventListener('click', debouncedSave);
paletteBtn?.addEventListener('click', debouncedSave);

const savedState = vscode.getState() as PersistedState | null;
if (savedState && savedState.schemaVersion === 1) {
  renderer.restoreState(savedState);
  if (savedState.layoutMode === 'offset' || savedState.layoutMode === 'overlay') {
    layoutMode = savedState.layoutMode;
    applyLayoutMode(layoutMode);
  }
  if (savedState.panelCollapsed) {
    sidePanel.classList.add('collapsed');
    if (panelToggle) { panelToggle.innerHTML = '&#x25B6;'; panelToggle.title = 'Show side panel'; }
    updateLayoutOffsetVar();
  }
  if (typeof savedState.panelWidth === 'number' && savedState.panelWidth >= 140) {
    sidePanel.style.width = savedState.panelWidth + 'px';
    updateLayoutOffsetVar();
  }
  if (scA && savedState.supercell) {
    scA.value = String(savedState.supercell[0]);
    scB.value = String(savedState.supercell[1]);
    scC.value = String(savedState.supercell[2]);
  }
  if (styleSelect && savedState.displayStyle) styleSelect.value = savedState.displayStyle;
  if (impostorCheck) impostorCheck.checked = renderer.getImpostorEnabled();
  if (cameraBtn && savedState.cameraMode) {
    cameraBtn.textContent = savedState.cameraMode === 'orthographic' ? 'Ortho' : 'Persp';
    cameraBtn.classList.toggle('active', savedState.cameraMode === 'orthographic');
  }
  if (paletteBtn && savedState.colorPalette) {
    paletteBtn.textContent = savedState.colorPalette === 'dark' ? '\u263E' : '\u2600';
    paletteBtn.title = savedState.colorPalette === 'dark' ? 'Color palette: Dark' : 'Color palette: Light';
    paletteBtn.classList.toggle('active', savedState.colorPalette === 'dark');
  }
  if (bondsCheck) bondsCheck.checked = savedState.showBonds;
  if (labelsCheck) labelsCheck.checked = savedState.showLabels;
  if (polyCheck) polyCheck.checked = false;
  if (boundaryCheck) boundaryCheck.checked = savedState.showBoundaryAtoms !== false;
  if (celldashCheck) celldashCheck.checked = savedState.showCellDash !== false;
  if (axisSizeSlider && typeof savedState.axisIndicatorSize === 'number') axisSizeSlider.value = String(savedState.axisIndicatorSize);
  if (stepAngleInput && typeof savedState.stepAngle === 'number') stepAngleInput.value = String(savedState.stepAngle);
  if (stepZoomInput && typeof savedState.stepZoom === 'number') stepZoomInput.value = String(savedState.stepZoom);
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: number;
  return () => { clearTimeout(timer); timer = window.setTimeout(fn, ms); };
}

// --- Properties panel ---
const atomsToggle = document.getElementById('atoms-toggle')!;
const atomsProps = document.getElementById('atoms-props')!;
const bondsToggleBtn = document.getElementById('bonds-toggle')!;
const bondsProps = document.getElementById('bonds-props')!;
const polyCentersSection = document.getElementById('poly-centers-section')!;
const polyCentersToggle = document.getElementById('poly-centers-toggle')!;
const polyCentersProps = document.getElementById('poly-centers-props')!;

function initTogglePanel(toggle: HTMLElement, content: HTMLElement, label: string) {
  toggle.addEventListener('click', () => {
    const nowHidden = content.classList.toggle('hidden');
    toggle.innerHTML = nowHidden ? `${label} &#x25B6;` : `${label} &#x25BC;`;
  });
}
initTogglePanel(atomsToggle, atomsProps, 'Atoms');
initTogglePanel(bondsToggleBtn, bondsProps, 'Bonds');
initTogglePanel(polyCentersToggle, polyCentersProps, 'Polyhedra centers');

const optionsToggle = document.getElementById('options-toggle');
const optionsProps = document.getElementById('options-props');
if (optionsToggle && optionsProps) initTogglePanel(optionsToggle, optionsProps, 'Options');

function updatePolyCentersVisibility() {
  const on = !!polyCheck?.checked;
  polyCentersSection.classList.toggle('hidden', !on);
}

function buildPolyCentersUI() {
  polyCentersProps.innerHTML = '';
  const elements = renderer.getElements();
  const active = new Set(renderer.getPolyhedraCenters());
  for (const el of elements) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.className = 'prop-vis';
    vis.checked = active.has(el);
    vis.addEventListener('change', () => {
      const current = new Set(renderer.getPolyhedraCenters());
      if (vis.checked) current.add(el); else current.delete(el);
      renderer.setPolyhedraCenters([...current]);
    });

    const label = document.createElement('span');
    label.className = 'prop-label';
    label.textContent = el;

    row.append(vis, label);
    polyCentersProps.appendChild(row);
  }
}

function buildAtomPropsUI() {
  atomsProps.innerHTML = '';
  const elements = renderer.getElements();
  for (const el of elements) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'prop-color';
    colorInput.value = renderer.getElementColor(el);
    colorInput.addEventListener('input', () => renderer.setElementColor(el, colorInput.value));

    const label = document.createElement('span');
    label.className = 'prop-label';
    label.textContent = el;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'prop-slider';
    slider.min = '0.1';
    slider.max = '1.5';
    slider.step = '0.05';
    slider.value = String(renderer.getElementRadius(el));
    slider.addEventListener('input', () => renderer.setElementRadius(el, parseFloat(slider.value)));

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.className = 'prop-vis';
    vis.checked = renderer.getElementVisibility(el);
    vis.addEventListener('change', () => renderer.setElementVisibility(el, vis.checked));

    row.append(vis, label, slider, colorInput);
    atomsProps.appendChild(row);
  }
}

function updateBondSkipHint() {
  const hint = document.getElementById('bond-skip-hint');
  const msg = document.getElementById('bond-skip-msg');
  const btn = document.getElementById('bond-force-btn') as HTMLButtonElement | null;
  if (!hint || !msg || !btn) return;
  const info = renderer.getBondSkipInfo();
  if (!info.skipped) { hint.classList.add('hidden'); return; }
  hint.classList.remove('hidden');
  msg.textContent = `\u26A0 Bond detection skipped \u2014 ${info.atomCount} atoms exceed the ${info.limit} limit. Estimated: ${info.estimateMs} ms.`;
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Computing\u2026';
    requestAnimationFrame(() => {
      renderer.setForceBonds(true);
      btn.disabled = false;
      btn.textContent = 'Compute anyway';
      updateBondSkipHint();
      buildBondPropsUI();
    });
  };
}

function buildBondPropsUI() {
  bondsProps.innerHTML = '';
  const pairs = renderer.getBondPairs();
  for (const { pair, min, max, enabled } of pairs) {
    const row = document.createElement('div');
    row.className = 'bond-row';

    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.className = 'prop-vis';
    vis.checked = enabled;
    vis.addEventListener('change', () => renderer.setBondPairEnabled(pair, vis.checked));

    const label = document.createElement('span');
    label.className = 'bond-label';
    label.textContent = pair;

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.className = 'bond-input';
    minInput.value = min.toFixed(2);
    minInput.step = '0.05';
    minInput.title = 'min';

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.className = 'bond-input';
    maxInput.value = max.toFixed(2);
    maxInput.step = '0.05';
    maxInput.title = 'max';

    const update = () => {
      renderer.updateBondCutoff(pair, parseFloat(minInput.value) || 0, parseFloat(maxInput.value) || 0);
    };
    minInput.addEventListener('change', update);
    maxInput.addEventListener('change', update);

    row.append(vis, label, minInput, maxInput);
    bondsProps.appendChild(row);
  }
}

// --- Extension messages ---
window.addEventListener('message', (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case 'loadStructure': {
      renderer.loadStructure(msg.data);
      const si = renderer.getStructureInfo();
      if (si) {
        const cp = si.cellParams;
        let txt = `${si.formula} | ${si.atomCount} atoms | ${si.spaceGroup}`;
        if (cp) txt += ` | a=${cp.a.toFixed(2)} b=${cp.b.toFixed(2)} c=${cp.c.toFixed(2)}`;
        txt += ` | V=${si.volume.toFixed(1)} \u00C5\u00B3`;
        info.textContent = txt;
      } else {
        info.textContent = `${msg.data.species.length} atoms | ${msg.data.title || ''}`;
      }
      buildAtomPropsUI();
      buildBondPropsUI();
      buildPolyCentersUI();
      updatePolyCentersVisibility();
      updateBondSkipHint();
      updateEllipsoidsSectionVisibility();
      updatePartialOccupancySectionVisibility();
      updateMagneticMomentsSectionVisibility();
      break;
    }
    case 'resetCamera': renderer.resetCamera(); break;
    case 'toggleBonds': renderer.toggleBonds(); break;
    case 'viewAlongDirection': renderer.viewAlongDirection(msg.uvw); break;
    case 'viewNormalToPlane': renderer.viewNormalToPlane(msg.hkl); break;
    case 'addLatticePlane': renderer.addLatticePlane(msg.hkl, msg.distance); break;
    case 'clearLatticePlanes': renderer.clearLatticePlanes(); break;
    case 'loadVolumetric': {
      renderer.loadVolumetric(msg.data);
      const isoSection = document.getElementById('iso-section')!;
      const isoSlider = document.getElementById('iso-slider') as HTMLInputElement;
      const isoInput = document.getElementById('iso-input') as HTMLInputElement;
      const range = renderer.getIsoRange();
      if (range) {
        isoSection.classList.remove('hidden');
        isoSection.style.display = '';
        isoSlider.min = '0';
        isoSlider.max = String(range.max);
        isoSlider.step = String(range.max / 200);
        isoSlider.value = String(renderer.getIsoLevel());
        isoInput.value = renderer.getIsoLevel().toExponential(3);
        // Replace elements to clear old listeners
        const newSlider = isoSlider.cloneNode(true) as HTMLInputElement;
        isoSlider.replaceWith(newSlider);
        const newInput = isoInput.cloneNode(true) as HTMLInputElement;
        isoInput.replaceWith(newInput);
        newSlider.addEventListener('input', () => {
          const level = parseFloat(newSlider.value);
          renderer.setIsoLevel(level);
          newInput.value = level.toExponential(3);
        });
        newInput.addEventListener('change', () => {
          const level = parseFloat(newInput.value);
          if (!isNaN(level) && level >= 0) {
            renderer.setIsoLevel(level);
            newSlider.value = String(level);
          }
        });
      }
      break;
    }
  }
});

vscode.postMessage({ type: 'ready' });
