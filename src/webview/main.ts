import { CrystalRenderer } from './renderer';
import { ExtensionMessage, DisplayStyle, CameraMode } from './message';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const tooltip = document.getElementById('tooltip') as HTMLDivElement;

// V2 info pill (bottom-left). Canonical formula readout, always visible
// (shifts horizontally to clear the side panel via body.panel-open).
const infoPill = document.getElementById('info-pill') as HTMLDivElement | null;
const pillFormula = document.getElementById('pill-formula') as HTMLSpanElement | null;
const pillMeta = document.getElementById('pill-meta') as HTMLSpanElement | null;
function setInfoPill(formula: string, metaHtml: string) {
  if (pillFormula) pillFormula.textContent = formula;
  if (pillMeta) pillMeta.innerHTML = metaHtml;
  infoPill?.classList.remove('hidden');
}
function clearInfoPill() {
  infoPill?.classList.add('hidden');
}

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

// --- Side panel toggle (V2 is overlay-only; offset/overlay toggle removed) ---
const panelToggle = document.getElementById('panel-toggle') as HTMLButtonElement;
const sidePanel = document.getElementById('side-panel') as HTMLDivElement;
const MODE_BAR_WIDTH = 40;

// SVG glyphs for the panel-toggle button (matches the unified icon set in
// crystalEditorProvider.ts; chevL = panel open, chevR = panel collapsed).
const SVG_CHEV_L = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>';
const SVG_CHEV_R = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>';

// `panel-open` body class drives layout that depends on whether the side
// panel is visible (e.g. info-pill horizontal offset in Feature 18.6d).
function applyPanelOpenClass() {
  document.body.classList.toggle('panel-open', !sidePanel.classList.contains('collapsed'));
}
applyPanelOpenClass();

if (panelToggle && sidePanel) {
  panelToggle.addEventListener('click', () => {
    const collapsed = sidePanel.classList.toggle('collapsed');
    panelToggle.innerHTML = collapsed ? SVG_CHEV_R : SVG_CHEV_L;
    panelToggle.title = collapsed ? 'Show side panel' : 'Hide side panel';
    applyPanelOpenClass();
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
    // Panel sits at left = MODE_BAR_WIDTH + 12px gap (V2 floating spec); the
    // pointer-x maps to the panel's right edge → width = pointer-x - that gap.
    const newWidth = Math.max(180, Math.min(420, e.clientX - MODE_BAR_WIDTH - 12));
    sidePanel.style.width = newWidth + 'px';
  });
  window.addEventListener('pointerup', () => {
    if (resizing) debouncedSave();
    resizing = false;
    panelResize.classList.remove('dragging');
  });
}

// --- Side panel controls ---

// Supercell — V2 `− N +` horizontal stepper per axis (no upper bound).
// Inputs use type="text" + inputmode="numeric" so native browser spinners
// stay out of the way; ±buttons are siblings inside .sc-steppers and
// dispatch 'change' on the input so updateSupercell fires.
const scA = document.getElementById('sc-a') as HTMLInputElement;
const scB = document.getElementById('sc-b') as HTMLInputElement;
const scC = document.getElementById('sc-c') as HTMLInputElement;
function updateSupercell() {
  renderer.setSupercell([
    Math.max(1, parseInt(scA.value) || 1),
    Math.max(1, parseInt(scB.value) || 1),
    Math.max(1, parseInt(scC.value) || 1),
  ]);
}
function setupSupercellStepper(input: HTMLInputElement | null) {
  if (!input) return;
  const wrap = input.closest('.sc-steppers') as HTMLElement | null;
  if (!wrap) return;
  const min = Number(input.dataset.axisMin ?? '1');
  const apply = (delta: number) => {
    const cur = parseInt(input.value, 10);
    const base = Number.isFinite(cur) ? cur : min;
    const next = Math.max(min, base + delta);
    if (String(next) === input.value) return;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  wrap.querySelector('.sc-dec')?.addEventListener('click', () => apply(-1));
  wrap.querySelector('.sc-inc')?.addEventListener('click', () => apply(+1));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp')        { e.preventDefault(); apply(+1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); apply(-1); }
  });
  input.addEventListener('blur', () => {
    const n = parseInt(input.value, 10);
    if (!Number.isFinite(n) || n < min) {
      input.value = String(min);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}
[scA, scB, scC].forEach((el) => setupSupercellStepper(el));
[scA, scB, scC].forEach((el) => el?.addEventListener('change', updateSupercell));

// Display style — V2 chips replacing the old <select>. Source-of-truth lives
// in the active chip's data-style attr; keep a `currentDisplayStyle` mirror
// for saved-state writeback. styleSelect alias retained as the chips
// container for the saveState `change`-event collector.
const styleChips = document.getElementById('display-style-chips') as HTMLElement;
let currentDisplayStyle: DisplayStyle = 'ball-and-stick';
function applyDisplayStyle(s: DisplayStyle, opts: { dispatch?: boolean } = {}) {
  currentDisplayStyle = s;
  if (styleChips) {
    styleChips.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.style === s);
    });
  }
  renderer.setDisplayStyle(s);
  if (opts.dispatch) styleChips?.dispatchEvent(new Event('change', { bubbles: true }));
}
if (styleChips) {
  styleChips.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip');
    if (!btn) return;
    const s = btn.dataset.style as DisplayStyle | undefined;
    if (!s || s === currentDisplayStyle) return;
    applyDisplayStyle(s, { dispatch: true });
  });
}
const styleSelect = styleChips; // alias — the saveState collector below addEventListener('change') on this

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

// 17.1.4 + 17.2.1 Trajectory playback (frame slider + play/pause + rAF loop +
// speed slider + frame input + once-only loop + keyboard)
const trajPlayBtn = document.getElementById('traj-play-btn') as HTMLButtonElement | null;
const trajSlider = document.getElementById('traj-slider') as HTMLInputElement | null;
const trajFrameInput = document.getElementById('traj-frame-input') as HTMLInputElement | null;
const trajFrameLabel = document.getElementById('traj-frame-label') as HTMLSpanElement | null;
const trajSpeedSlider = document.getElementById('traj-speed-slider') as HTMLInputElement | null;
const trajSpeedLabel = document.getElementById('traj-speed-label') as HTMLSpanElement | null;
const trajLoopCheck = document.getElementById('traj-loop-check') as HTMLInputElement | null;
let trajPlaying = false;
let trajRafId: number | null = null;
const TRAJ_BASE_FPS = 30;
let trajSpeed = 1.0;
let trajLastTick = 0;

function trajFrameMs(): number { return 1000 / (TRAJ_BASE_FPS * trajSpeed); }

function setTrajFrame(idx: number) {
  renderer.setFrame(idx);
  if (trajSlider) trajSlider.value = String(idx);
  if (trajFrameInput) trajFrameInput.value = String(idx + 1);
  if (trajFrameLabel) {
    trajFrameLabel.textContent = `/ ${renderer.getFrameCount()}`;
  }
  // 17.2.3: refresh comparison stats panel since renderer.setFrame already
  // re-ran recomputeComparison() (when active) and updated lastStats.
  updateComparisonStatsUI();
}

function trajPlayLoop(t: number) {
  if (!trajPlaying) return;
  if (t - trajLastTick >= trajFrameMs()) {
    trajLastTick = t;
    const cur = renderer.getCurrentFrame();
    const total = renderer.getFrameCount();
    const next = cur + 1;
    if (next >= total) {
      // End of trajectory — loop or stop based on Loop checkbox.
      if (trajLoopCheck && trajLoopCheck.checked) {
        setTrajFrame(0);
      } else {
        trajSetPlaying(false);
        return;
      }
    } else {
      setTrajFrame(next);
    }
  }
  trajRafId = requestAnimationFrame(trajPlayLoop);
}

function trajSetPlaying(p: boolean) {
  trajPlaying = p;
  if (trajPlayBtn) trajPlayBtn.textContent = p ? '⏸' : '▶';
  if (p) {
    trajLastTick = performance.now();
    trajRafId = requestAnimationFrame(trajPlayLoop);
  } else if (trajRafId !== null) {
    cancelAnimationFrame(trajRafId);
    trajRafId = null;
  }
}

if (trajPlayBtn) {
  trajPlayBtn.addEventListener('click', () => trajSetPlaying(!trajPlaying));
}
if (trajSlider) {
  trajSlider.addEventListener('input', () => {
    if (trajPlaying) trajSetPlaying(false);   // user scrub pauses playback
    setTrajFrame(parseInt(trajSlider.value));
  });
}
// 17.2.1 frame number direct input (Enter to jump)
if (trajFrameInput) {
  trajFrameInput.addEventListener('change', () => {
    if (trajPlaying) trajSetPlaying(false);
    const n = parseInt(trajFrameInput.value);
    if (Number.isFinite(n)) setTrajFrame(n - 1);
  });
}
// 17.2.1 speed slider
if (trajSpeedSlider) {
  trajSpeedSlider.addEventListener('input', () => {
    trajSpeed = parseFloat(trajSpeedSlider.value);
    if (trajSpeedLabel) trajSpeedLabel.textContent = `${trajSpeed.toFixed(2)}×`;
  });
}
// 17.2.1 Phases section (list rendering + Add Phase btn + Comparison toggle)
function rebuildPhasesList() {
  const list = document.getElementById('phases-list');
  if (!list) return;
  list.innerHTML = '';
  const phases = renderer.getPhases();
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const row = document.createElement('div');
    row.className = 'phase-row';
    row.dataset.idx = String(i);
    const visEl = document.createElement('input');
    visEl.type = 'checkbox';
    visEl.className = 'phase-vis';
    visEl.checked = p.visible;
    visEl.title = 'Show / hide this phase';
    visEl.addEventListener('change', () => renderer.setPhaseVisible(i, visEl.checked));
    const labelEl = document.createElement('span');
    labelEl.className = 'phase-label';
    labelEl.textContent = `phase ${i + 1} (${p.atomCount} atoms)`;
    const opEl = document.createElement('input');
    opEl.type = 'range';
    opEl.className = 'phase-opacity';
    opEl.min = '0'; opEl.max = '1'; opEl.step = '0.05';
    opEl.value = String(p.opacity);
    opEl.title = `Opacity ${p.opacity.toFixed(2)}`;
    opEl.addEventListener('input', () => {
      renderer.setPhaseOpacity(i, parseFloat(opEl.value));
      opEl.title = `Opacity ${opEl.value}`;
    });
    const rmEl = document.createElement('button');
    rmEl.className = 'phase-remove panel-btn';
    rmEl.textContent = '×';
    rmEl.title = 'Remove this phase';
    rmEl.addEventListener('click', () => {
      renderer.removePhase(i);
      rebuildPhasesList();
      const ct = document.getElementById('compare-toggle') as HTMLInputElement | null;
      if (ct) ct.checked = renderer.isComparisonActive();
    });
    row.appendChild(visEl);
    row.appendChild(labelEl);
    row.appendChild(opEl);
    row.appendChild(rmEl);
    list.appendChild(row);
  }
}
function updatePhasesSectionVisibility() {
  const section = document.getElementById('phases-section');
  if (!section) return;
  // Always show when a structure is loaded — Add Phase button is the entry
  // point for users to discover the feature.
  if (renderer.getStructureInfo()) {
    section.classList.remove('hidden');
  } else {
    section.classList.add('hidden');
  }
  rebuildPhasesList();
  const ct = document.getElementById('compare-toggle') as HTMLInputElement | null;
  if (ct) ct.checked = renderer.isComparisonActive();
  updateComparisonStatsUI();
}

// 17.2.3 RMSD/displacement summary panel.
function updateComparisonStatsUI() {
  const div = document.getElementById('comparison-stats');
  if (!div) return;
  const stats = renderer.getComparisonStats();
  if (!stats || !renderer.isComparisonActive()) {
    div.classList.add('hidden');
    div.innerHTML = '';
    return;
  }
  div.classList.remove('hidden');
  // Render compact stat block. Numbers in Å with 4 sig fig (RMSD/max/mean
  // typically 0.001–10 Å range).
  const fmt = (x: number) => x < 0.001 ? '<0.001' : x.toPrecision(3);
  div.innerHTML = `
    <div class="stat-row"><span class="stat-key">RMSD</span><span>${fmt(stats.rmsd)} Å</span></div>
    <div class="stat-row"><span class="stat-key">max</span><span>${fmt(stats.maxDisplacement)} Å</span></div>
    <div class="stat-row"><span class="stat-key">mean</span><span>${fmt(stats.meanDisplacement)} Å</span></div>
    <div class="stat-row"><span class="stat-key">p95</span><span>${fmt(stats.p95Displacement)} Å</span></div>
    <div class="stat-row"><span class="stat-key">matched / unmatched</span><span>${stats.matchedCount} / ${stats.unmatchedCount}</span></div>
  `;
}
const addPhaseBtn = document.getElementById('add-phase-btn');
if (addPhaseBtn) {
  addPhaseBtn.addEventListener('click', () => vscode.postMessage({ type: 'addPhaseRequest' }));
}
const compareToggle = document.getElementById('compare-toggle') as HTMLInputElement | null;
if (compareToggle) {
  compareToggle.addEventListener('change', () => {
    if (compareToggle.checked) {
      const r = renderer.compareToPhase();
      if (!r.ok) {
        compareToggle.checked = false;
        // 17.2.1 toast upgrade — surface failure reason via vscode notification
        vscode.postMessage({ type: 'comparisonResult', ok: false, reason: r.reason });
      }
    } else {
      renderer.clearComparison();
    }
    // 17.2.3: refresh stats panel after toggle change
    updateComparisonStatsUI();
  });
}

// 17.2.1 keyboard: Space toggles play/pause when trajectory is loaded and
// no input/textarea has focus.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (!renderer.hasTrajectory()) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  e.preventDefault();
  trajSetPlaying(!trajPlaying);
});
const trajBondRecomputeCheck = document.getElementById('traj-bond-recompute') as HTMLInputElement | null;
if (trajBondRecomputeCheck) {
  trajBondRecomputeCheck.addEventListener('change', () => {
    renderer.setRecomputeBondsPerFrame(trajBondRecomputeCheck.checked);
  });
}
const RECOMPUTE_AUTO_DISABLE_THRESHOLD = 5000;

function updateTrajectorySectionVisibility() {
  const section = document.getElementById('trajectory-section');
  if (!section) return;
  if (renderer.hasTrajectory()) {
    section.classList.remove('hidden');
    const n = renderer.getFrameCount();
    if (trajSlider) {
      trajSlider.min = '0';
      trajSlider.max = String(n - 1);
      trajSlider.value = String(renderer.getCurrentFrame());
    }
    if (trajFrameInput) {
      trajFrameInput.min = '1';
      trajFrameInput.max = String(n);
      trajFrameInput.value = String(renderer.getCurrentFrame() + 1);
    }
    if (trajFrameLabel) {
      trajFrameLabel.textContent = `/ ${n}`;
    }
    if (trajBondRecomputeCheck) {
      // Auto-disable for large structures: O(N) per frame at >5k atoms
      // breaks 30fps even with bond-detection optimizations.
      const tooBig = renderer.getAtomCount() > RECOMPUTE_AUTO_DISABLE_THRESHOLD;
      trajBondRecomputeCheck.disabled = tooBig;
      if (tooBig) {
        trajBondRecomputeCheck.checked = false;
        renderer.setRecomputeBondsPerFrame(false);
      } else {
        trajBondRecomputeCheck.checked = renderer.getRecomputeBondsPerFrame();
      }
    }
  } else {
    if (trajPlaying) trajSetPlaying(false);
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

// Palette toggle (top bar icon). Inline SVGs mirror the unified icon set in
// crystalEditorProvider.ts — duplicated (small, two strings) since the HTML
// template and webview JS run in different bundles.
const SVG_MOON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>';
const SVG_SUN  = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.8"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.1 1.1M11.15 11.15l1.1 1.1M3.75 12.25l1.1-1.1M11.15 4.85l1.1-1.1"/></svg>';
const paletteBtn = document.getElementById('palette-toggle') as HTMLButtonElement;
if (paletteBtn) {
  paletteBtn.addEventListener('click', () => {
    const next = renderer.getColorPalette() === 'dark' ? 'light' : 'dark';
    renderer.setColorPalette(next);
    paletteBtn.innerHTML = next === 'dark' ? SVG_MOON : SVG_SUN;
    paletteBtn.title = next === 'dark' ? 'Color palette: Dark' : 'Color palette: Light';
    paletteBtn.classList.toggle('active', next === 'dark');
  });
}

// Numeric stepper (full-height ▲/▼ + ArrowUp/Down keys) for step-angle,
// step-zoom, sc-a/b/c. Inputs use type="text" + inputmode="numeric" to
// avoid native browser spinners; this helper restores keyboard/button
// increment and dispatches a synthetic 'change' so existing listeners fire.
function setupNumberStepper(input: HTMLInputElement | null) {
  if (!input) return;
  const wrap = input.closest('.num-wrap') as HTMLElement | null;
  if (!wrap) return;
  const min = Number(wrap.dataset.min ?? '1');
  const max = Number(wrap.dataset.max ?? '99');
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const apply = (delta: number) => {
    const cur = parseInt(input.value, 10);
    const base = Number.isFinite(cur) ? cur : min;
    const next = clamp(base + delta);
    if (String(next) === input.value) return;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  wrap.querySelector('.num-step.up')?.addEventListener('click', () => apply(+1));
  wrap.querySelector('.num-step.dn')?.addEventListener('click', () => apply(-1));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp')        { e.preventDefault(); apply(+1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); apply(-1); }
  });
  // Permit transient invalid states mid-edit; clamp on blur.
  input.addEventListener('blur', () => {
    const n = parseInt(input.value, 10);
    if (!Number.isFinite(n)) {
      input.value = String(min);
    } else {
      const c = clamp(n);
      if (String(c) !== input.value) input.value = String(c);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
// Supercell inputs (sc-a/b/c) intentionally left as native type="number"
// here — Feature 18.6 will replace them with V2's `− N +` horizontal stepper
// (no upper bound), which has different markup than this generic .num-wrap.
['step-angle', 'step-zoom'].forEach((id) => {
  setupNumberStepper(document.getElementById(id) as HTMLInputElement | null);
});

// ----- iOS-style toggle switches (V2) ---------------------------------------
// Native checkbox stays in DOM (label-clickable, focusable, change-event
// intact); a sibling .switch span renders the visual control. Walks every
// .toggle input[type=checkbox] once at startup. Re-callable when new
// .toggle rows are inserted dynamically (atoms/bonds/poly-centers UIs).
function setupToggleSwitches(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>('.toggle input[type="checkbox"]').forEach((input) => {
    if (input.dataset.switchInjected === '1') return;
    input.dataset.switchInjected = '1';
    const sw = document.createElement('span');
    sw.className = 'switch';
    if (input.checked) sw.classList.add('on');
    sw.appendChild(document.createElement('span')).className = 'switch-thumb';
    // Insert switch right after the input. The label already wraps both
    // (and a text <span>), so the click-toggle native label behaviour still
    // forwards to the input regardless of where in the label the user clicks.
    input.parentElement?.insertBefore(sw, input.nextSibling);
    input.addEventListener('change', () => {
      sw.classList.toggle('on', input.checked);
    });
  });
}
setupToggleSwitches();

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
// `layoutMode` is retained in the type union for forward-compatibility:
// older saved state may still carry it; we read it but no longer act on it
// (V2 is overlay-only as of v0.18.0).
type PersistedState = ReturnType<typeof renderer.getState> & {
  layoutMode?: 'offset' | 'overlay';
  panelCollapsed?: boolean;
  panelWidth?: number;
  stepAngle?: number;
  stepZoom?: number;
};
function saveState() {
  const s = renderer.getState() as PersistedState;
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
  // savedState.layoutMode silently ignored (V2 is overlay-only).
  if (savedState.panelCollapsed) {
    sidePanel.classList.add('collapsed');
    if (panelToggle) { panelToggle.innerHTML = SVG_CHEV_R; panelToggle.title = 'Show side panel'; }
    applyPanelOpenClass();
  }
  if (typeof savedState.panelWidth === 'number' && savedState.panelWidth >= 180) {
    sidePanel.style.width = savedState.panelWidth + 'px';
  }
  if (scA && savedState.supercell) {
    scA.value = String(savedState.supercell[0]);
    scB.value = String(savedState.supercell[1]);
    scC.value = String(savedState.supercell[2]);
  }
  if (savedState.displayStyle) applyDisplayStyle(savedState.displayStyle as DisplayStyle);
  if (impostorCheck) impostorCheck.checked = renderer.getImpostorEnabled();
  if (cameraBtn && savedState.cameraMode) {
    cameraBtn.textContent = savedState.cameraMode === 'orthographic' ? 'Ortho' : 'Persp';
    cameraBtn.classList.toggle('active', savedState.cameraMode === 'orthographic');
  }
  if (paletteBtn && savedState.colorPalette) {
    paletteBtn.innerHTML = savedState.colorPalette === 'dark' ? SVG_MOON : SVG_SUN;
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
        const meta: string[] = [si.spaceGroup, `<b>${si.atomCount}</b> atoms`];
        if (si.volume) meta.push(`<b>${si.volume.toFixed(1)}</b> \u00C5\u00B3`);
        setInfoPill(si.formula, meta.join(' \u00B7 '));
      } else {
        const t = msg.data.title || `${msg.data.species.length} atoms`;
        setInfoPill(t, `<b>${msg.data.species.length}</b> atoms`);
      }
      buildAtomPropsUI();
      buildBondPropsUI();
      buildPolyCentersUI();
      updatePolyCentersVisibility();
      updateBondSkipHint();
      updateEllipsoidsSectionVisibility();
      updatePartialOccupancySectionVisibility();
      updateMagneticMomentsSectionVisibility();
      // 17.1.4: hide trajectory section if previously a multi-frame file was
      // loaded in this webview session (loadStructure resets trajectory).
      updateTrajectorySectionVisibility();
      // 17.2.1: phases section visibility (always shown when a structure
      // is loaded, even before any phase is added).
      updatePhasesSectionVisibility();
      break;
    }
    case 'resetCamera': renderer.resetCamera(); break;
    case 'toggleBonds': renderer.toggleBonds(); break;
    case 'viewAlongDirection': renderer.viewAlongDirection(msg.uvw); break;
    case 'viewNormalToPlane': renderer.viewNormalToPlane(msg.hkl); break;
    case 'addLatticePlane': renderer.addLatticePlane(msg.hkl, msg.distance); break;
    case 'clearLatticePlanes': renderer.clearLatticePlanes(); break;
    case 'setWulff': {
      try {
        renderer.setWulff(msg.planes);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Wulff construction failed:', e);
      }
      break;
    }
    case 'clearWulff': renderer.clearWulff(); break;
    case 'loadTrajectory': {
      // 17.1.0: trajectory entry. For 1-frame trajectories the path is
      // observably equivalent to loadStructure; for >1 frame, 17.1.4 wires
      // up the side-panel slider via updateTrajectorySectionVisibility().
      // 17.1.4: stop any in-progress playback before swapping data.
      trajSetPlaying(false);
      renderer.loadTrajectory(msg.data);
      const f0 = msg.data.frames[0];
      const si = renderer.getStructureInfo();
      if (si) {
        const meta: string[] = [si.spaceGroup, `<b>${si.atomCount}</b> atoms`];
        if (si.volume) meta.push(`<b>${si.volume.toFixed(1)}</b> \u00C5\u00B3`);
        if (msg.data.frames.length > 1) meta.push(`<b>${msg.data.frames.length}</b> frames`);
        setInfoPill(si.formula, meta.join(' \u00B7 '));
      } else {
        const t = f0.title || `${f0.species.length} atoms`;
        const meta: string[] = [`<b>${f0.species.length}</b> atoms`];
        if (msg.data.frames.length > 1) meta.push(`<b>${msg.data.frames.length}</b> frames`);
        setInfoPill(t, meta.join(' \u00B7 '));
      }
      buildAtomPropsUI();
      buildBondPropsUI();
      buildPolyCentersUI();
      updatePolyCentersVisibility();
      updateBondSkipHint();
      updateEllipsoidsSectionVisibility();
      updatePartialOccupancySectionVisibility();
      updateMagneticMomentsSectionVisibility();
      updateTrajectorySectionVisibility();
      updatePhasesSectionVisibility();
      break;
    }
    case 'setFrame': renderer.setFrame(msg.index); break;
    case 'addPhase':
      renderer.addPhase(msg.data, msg.offset, msg.opacity);
      updatePhasesSectionVisibility();
      break;
    case 'clearPhases':
      renderer.clearPhases();
      updatePhasesSectionVisibility();
      break;
    case 'setPhaseVisible':
      renderer.setPhaseVisible(msg.index, msg.visible);
      break;
    case 'setPhaseOpacity':
      renderer.setPhaseOpacity(msg.index, msg.opacity);
      break;
    case 'removePhase':
      renderer.removePhase(msg.index);
      updatePhasesSectionVisibility();
      break;
    case 'compareToPhase': {
      const r = renderer.compareToPhase();
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.warn('compareToPhase:', r.reason);
      }
      break;
    }
    case 'clearComparison':
      renderer.clearComparison();
      break;
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
