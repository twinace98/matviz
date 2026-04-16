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

if (panelToggle && sidePanel) {
  panelToggle.addEventListener('click', () => {
    const collapsed = sidePanel.classList.toggle('collapsed');
    panelToggle.innerHTML = collapsed ? '&#x25B6;' : '&#x25C0;';
    panelToggle.title = collapsed ? 'Show side panel' : 'Hide side panel';
  });
}

// --- Side panel resize ---
const panelResize = document.getElementById('panel-resize') as HTMLDivElement;
const MODE_BAR_WIDTH = 40;

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
  });
  window.addEventListener('pointerup', () => {
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
if (polyCheck) polyCheck.addEventListener('change', () => renderer.togglePolyhedra());
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
  tooltip.style.display = 'none';
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
  'rot-up':    [-1, 'x'],
  'rot-down':  [1,  'x'],
  'rot-left':  [-1, 'y'],
  'rot-right': [1,  'y'],
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

// --- Keyboard controls ---
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const step = e.shiftKey ? 1 : getStepAngle();
  switch (e.key) {
    case 'ArrowUp':    renderer.rotateCamera(-step, 'x'); e.preventDefault(); break;
    case 'ArrowDown':  renderer.rotateCamera(step,  'x'); e.preventDefault(); break;
    case 'ArrowLeft':  renderer.rotateCamera(-step, 'y'); e.preventDefault(); break;
    case 'ArrowRight': renderer.rotateCamera(step,  'y'); e.preventDefault(); break;
    case '+': case '=': renderer.zoom(1 - getStepZoom()); e.preventDefault(); break;
    case '-':           renderer.zoom(1 + getStepZoom()); e.preventDefault(); break;
    case 'Escape':
      renderer.clearSelection();
      renderer.clearMeasurements();
      tooltip.style.display = 'none';
      break;
  }
});

// --- Picking callbacks ---
renderer.setAtomSelectCallback((data) => {
  if (data) {
    tooltip.style.display = 'block';
    tooltip.style.left = '250px';
    tooltip.style.bottom = '8px';
    tooltip.style.top = 'auto';
    const f = data.fractional;
    tooltip.innerHTML = `<b>${data.element}</b> #${data.index}<br>` +
      `Cart: (${data.cartesian[0].toFixed(3)}, ${data.cartesian[1].toFixed(3)}, ${data.cartesian[2].toFixed(3)})<br>` +
      `Frac: (${f[0].toFixed(4)}, ${f[1].toFixed(4)}, ${f[2].toFixed(4)})`;
    vscode.postMessage({ type: 'atomSelected', data });
  } else {
    tooltip.style.display = 'none';
  }
});

renderer.setMeasurementCallback((data) => {
  const unit = data.type === 'distance' ? ' \u00C5' : '\u00B0';
  tooltip.style.display = 'block';
  tooltip.innerHTML += `<br>${data.type}: ${data.value.toFixed(3)}${unit}`;
  vscode.postMessage({ type: 'measurement', data });
});

// --- Theme ---
const mq = window.matchMedia('(prefers-color-scheme: dark)');
mq.addEventListener('change', () => renderer.updateTheme());
new MutationObserver(() => renderer.updateTheme())
  .observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });

// --- State persistence ---
function saveState() { vscode.setState(renderer.getState()); }
const debouncedSave = debounce(saveState, 500);
window.addEventListener('pointerup', debouncedSave);
window.addEventListener('wheel', debouncedSave);

const savedState = vscode.getState() as ReturnType<typeof renderer.getState> | null;
if (savedState) {
  renderer.restoreState(savedState);
  if (scA && savedState.supercell) {
    scA.value = String(savedState.supercell[0]);
    scB.value = String(savedState.supercell[1]);
    scC.value = String(savedState.supercell[2]);
  }
  if (styleSelect && savedState.displayStyle) styleSelect.value = savedState.displayStyle;
  if (cameraBtn && savedState.cameraMode) {
    cameraBtn.textContent = savedState.cameraMode === 'orthographic' ? 'Ortho' : 'Persp';
    cameraBtn.classList.toggle('active', savedState.cameraMode === 'orthographic');
  }
  if (paletteBtn && savedState.colorPalette) {
    paletteBtn.textContent = savedState.colorPalette === 'dark' ? '\u263E' : '\u2600';
    paletteBtn.title = savedState.colorPalette === 'dark' ? 'Color palette: Dark' : 'Color palette: Light';
    paletteBtn.classList.toggle('active', savedState.colorPalette === 'dark');
  }
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

function initTogglePanel(toggle: HTMLElement, content: HTMLElement, label: string) {
  toggle.addEventListener('click', () => {
    const open = content.style.display !== 'none';
    content.style.display = open ? 'none' : 'flex';
    toggle.innerHTML = open ? `${label} &#x25B6;` : `${label} &#x25BC;`;
  });
}
initTogglePanel(atomsToggle, atomsProps, 'Atoms');
initTogglePanel(bondsToggleBtn, bondsProps, 'Bonds');

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
