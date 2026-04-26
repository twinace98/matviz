import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { CrystalStructure, CrystalTrajectory } from '../parsers/types';
import { getElement } from '../shared/elements-data';
import { getElementPaletteColor, getPaletteLineColors } from '../shared/elements-palette';
import type { ColorPalette } from '../shared/elements-palette';
import type { DisplayStyle, CameraMode, BondStyle } from './message';
import { marchingCubes, marchingSquaresFill, tileVolumetricPBC } from './marchingCubes';
import { AxisIndicator } from './axisIndicator';
import { BondRenderer, type BondInfo } from './bondRenderer';
import { SphereImpostorMesh, createImpostorMaterial } from './sphereImpostor';
import { EllipsoidRenderer, type EllipsoidInstance, type ProbabilityContour } from './ellipsoidRenderer';
import { MagneticArrowRenderer, type MagneticArrowInstance, type Colormap as MagColormap } from './magneticArrowRenderer';
import { DisplacementArrowRenderer } from './displacementArrowRenderer';
import { matchByNN, type DisplacementPair } from './nnMatching';

/**
 * v0.17.2.3 — Comparison statistics shown in the side-panel summary.
 * RMSD + magnitude percentiles over matched pairs only; unmatched
 * counted separately.
 */
export interface ComparisonStats {
  rmsd: number;              // Å, sqrt(mean(d²)) over matched pairs
  maxDisplacement: number;   // Å
  meanDisplacement: number;  // Å
  p95Displacement: number;   // Å
  matchedCount: number;
  unmatchedCount: number;
}

function computeComparisonStats(pairs: DisplacementPair[], unmatchedCount: number): ComparisonStats {
  if (pairs.length === 0) {
    return { rmsd: 0, maxDisplacement: 0, meanDisplacement: 0, p95Displacement: 0, matchedCount: 0, unmatchedCount };
  }
  const mags: number[] = new Array(pairs.length);
  let sum2 = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < pairs.length; i++) {
    const d = pairs[i].displacement;
    const m2 = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
    const m = Math.sqrt(m2);
    mags[i] = m;
    sum2 += m2;
    sum += m;
    if (m > max) max = m;
  }
  mags.sort((a, b) => a - b);
  const p95 = mags[Math.min(mags.length - 1, Math.floor(0.95 * mags.length))];
  return {
    rmsd: Math.sqrt(sum2 / pairs.length),
    maxDisplacement: max,
    meanDisplacement: sum / pairs.length,
    p95Displacement: p95,
    matchedCount: pairs.length,
    unmatchedCount,
  };
}
import { computeWulffGeometry, planesFromMillerIndices } from './wulff';
import { AtomPickingRenderer } from './picking';
import type { VolumetricData } from '../parsers/types';

// CPU raycaster is faster for small scenes — only switch to GPU picking above
// this threshold (where per-mesh raycast loops grow O(N)).
const GPU_PICK_THRESHOLD = 5000;

interface BondParams {
  min: number;
  max: number;
  enabled: boolean;
}

interface MeasurementObj {
  type: 'distance' | 'angle' | 'dihedral';
  atoms: number[];
  value: number;
  objects: THREE.Object3D[];
}

export class CrystalRenderer {
  private scene: THREE.Scene;
  private perspCamera: THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.Camera;
  private cameraMode: CameraMode = 'orthographic';
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private canvas: HTMLCanvasElement;

  private atomGroup = new THREE.Group();
  private bondRenderer = new BondRenderer({
    getElementColor: (el) => this.getElementColor(el),
    getPhongMaterial: (color, shininess) => this.getMaterial(color, shininess),
    getCylinderSegments: (n) => this.getCylinderSegments(n),
    getUnicolorColor: () => this.paletteColors().bondUnicolor,
    getImpostorEnabled: () => this.impostorEnabled,
    registerImpostorMaterial: (mat) => {
      this.bondImpostorMaterial = mat;
      if (mat) mat.uniforms.uOrtho.value = (this.cameraMode === 'orthographic');
    },
  });
  private cellGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private polyhedraGroup = new THREE.Group();
  private measureGroup = new THREE.Group();
  private planeGroup = new THREE.Group();
  private isoGroup = new THREE.Group();

  private structure: CrystalStructure | null = null;
  private supercell: [number, number, number] = [1, 1, 1];
  private showBonds = true;
  private showLabels = false;
  private showPolyhedra = false;
  private showBoundaryAtoms = true;
  private showCellDash = true;
  private displayStyle: DisplayStyle = 'ball-and-stick';
  private bondStyle: BondStyle = 'bicolor';
  private interactionMode: 'navigate' | 'measure' = 'navigate';
  private impostorEnabled = true;
  private currentImpostorMaterial: THREE.ShaderMaterial | null = null;
  private bondImpostorMaterial: THREE.ShaderMaterial | null = null;

  // 16.1 thermal ellipsoids — opt-in. Atoms with thermalAniso[i] != null AND
  // showEllipsoids=true are routed through ellipsoidRenderer (Phong-only,
  // separate InstancedMesh per element). Atoms without aniso, or all atoms
  // when showEllipsoids=false, fall through to the regular sphere/impostor
  // path.
  private ellipsoidRenderer = new EllipsoidRenderer();
  private showEllipsoids = false;

  // 16.2 partial occupancy — opt-in. Atoms with occupancy < 1.0 AND
  // showPartialOccupancy=true render as individual transparent Phong meshes
  // (per-site opacity preserved). Otherwise rendered as full atoms via the
  // regular path (matches the pre-v0.16 behavior — no visual change off).
  private showPartialOccupancy = false;

  // 16.3 magnetic moment vectors — opt-in arrow overlay. Independent of
  // atom rendering (doesn't peel atoms off the regular path; arrows just
  // overlay). Hidden by default; UI surfaces only when structure carries
  // magMom data.
  private magneticArrowRenderer = new MagneticArrowRenderer();
  private showMagneticMoments = false;

  // 16.4 Wulff construction — command-palette driven overlay.
  private wulffGroup = new THREE.Group();
  private currentWulffPlanes: Array<{ h: number; k: number; l: number; gamma: number }> | null = null;

  // v0.17 trajectory state. Null means single-frame mode (loaded via
  // loadStructure). Trajectory loaded via loadTrajectory; setFrame swaps
  // this.structure to a different frame WITHOUT the heavy reset that
  // loadStructure does (bondParams, selection, measurements persist
  // across frames so user state isn't lost during playback).
  private trajectory: CrystalTrajectory | null = null;
  private currentFrameIndex = 0;
  // v0.17.2 multi-phase overlay — additional structures rendered alongside
  // the primary. Each is rendered as transparent atoms (no bonds/boundary)
  // with a configurable cartesian offset. Rebuilt when addPhase/clearPhases
  // is called; not affected by setFrame (primary trajectory plays
  // independently of overlaid phases).
  private secondaryPhasesGroup = new THREE.Group();
  private secondaryPhases: { struct: CrystalStructure; offset: [number, number, number]; opacity: number }[] = [];

  // v0.17.1 (17.3) comparison mode — displacement arrows between primary
  // current frame and first secondary phase. `comparisonActive` + the
  // cached `comparisonSecondaryPhase` reference drive frame-aware
  // recomputation when `setFrame()` advances the primary trajectory.
  private displacementArrowRenderer = new DisplacementArrowRenderer();
  private comparisonActive = false;
  private comparisonSecondaryPhase: { struct: CrystalStructure; offset: [number, number, number]; opacity: number } | null = null;
  // 17.2.3 RMSD/displacement summary stats — recomputed in
  // recomputeComparison(). UI reads via getComparisonStats().
  private lastComparisonStats: ComparisonStats | null = null;
  // 17.1.5 perf knob: when true, every setFrame re-runs detectBonds
  // (O(N) spatial hash). Default false — first frame's bonds are inherited
  // by all subsequent frames, accepting that bonds may be slightly off
  // when atoms drift far in MD. Auto-disabled in UI for >5k atoms.
  private recomputeBondsPerFrame = false;

  // Per-element user overrides
  private elementColorOverrides = new Map<string, string>();
  private elementRadiusOverrides = new Map<string, number>();
  private elementVisibility = new Map<string, boolean>();
  private colorPalette: ColorPalette = 'dark';

  // Which element symbols are drawn as polyhedra centers (empty ⇒ nothing to draw).
  // Populated automatically on structure load (auto-detect cation-like 4–8-coord
  // elements) unless restored from saved state.
  private polyhedraCenters = new Set<string>();
  private polyhedraCentersUserSet = false;

  // On-demand rendering
  private renderRequested = false;

  // Material cache
  private materialCache = new Map<string, THREE.MeshPhongMaterial>();

  // Resource tracking
  private geometries: THREE.BufferGeometry[] = [];
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];

  // Cached expanded data
  private expandedSpecies: string[] = [];
  private expandedPositions: [number, number, number][] = [];
  private expandedUnitCellIndex: number[] = []; // maps expanded atom → unit cell atom index
  private cachedBonds: BondInfo[] = [];

  // Per-pair bond parameters
  private bondParams = new Map<string, BondParams>();

  // Label texture cache
  private labelTextureCache = new Map<string, THREE.Texture>();

  // Animation
  private animating = false;

  // Selection / picking
  private raycaster = new THREE.Raycaster();
  private selectedAtoms: number[] = [];
  private measurements: MeasurementObj[] = [];
  private onAtomSelect: ((data: { index: number; element: string; cartesian: [number, number, number]; fractional: [number, number, number] } | null) => void) | null = null;
  private onMeasurement: ((data: { type: 'distance' | 'angle' | 'dihedral'; value: number; atoms: number[] }) => void) | null = null;

  // Atom index mapping: which InstancedMesh corresponds to which atom range
  private atomMeshMap: { mesh: THREE.InstancedMesh; globalIndices: number[]; baseColor: THREE.Color }[] = [];
  private static readonly HIGHLIGHT_COLOR = new THREE.Color(0x00ffff);

  // Axis indicator (bottom-left inset)
  private axisIndicator = new AxisIndicator();

  // GPU-based atom picking (used when expandedPositions.length >= GPU_PICK_THRESHOLD)
  private pickingRenderer = new AtomPickingRenderer();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();

    const aspect = canvas.clientWidth / canvas.clientHeight;

    this.perspCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
    this.perspCamera.position.set(0, 0, 20);

    const frustumSize = 20;
    this.orthoCamera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2, frustumSize * aspect / 2,
      frustumSize / 2, -frustumSize / 2, 0.1, 500
    );
    this.orthoCamera.position.set(0, 0, 20);

    this.activeCamera = this.orthoCamera;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    const bgColor = this.getBackgroundColor();
    this.scene.fog = new THREE.FogExp2(bgColor, 0.015);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 7);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-5, -5, -5);
    this.scene.add(ambient, dir1, dir2);

    this.scene.add(this.atomGroup, this.bondRenderer.group, this.cellGroup, this.labelGroup, this.polyhedraGroup, this.measureGroup, this.planeGroup, this.isoGroup, this.ellipsoidRenderer.group, this.magneticArrowRenderer.group, this.wulffGroup, this.secondaryPhasesGroup, this.displacementArrowRenderer.group);
    this.labelGroup.renderOrder = 999;
    this.labelGroup.visible = false;
    this.polyhedraGroup.visible = false;

    this.controls = new OrbitControls(this.activeCamera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.enableRotate = false; // We handle rotation ourselves (quaternion-based)
    this.controls.addEventListener('change', () => this.requestRender());

    this.initAxisIndicator();

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // Click handler for picking
    canvas.addEventListener('click', (e) => this.onCanvasClick(e));

    // Quaternion-based free rotation (no gimbal lock) + constrained rotation
    this.initFreeRotation(canvas);

    this.requestRender();
  }

  // --- Public API ---

  loadStructure(structure: CrystalStructure) {
    this.structure = structure;
    // Single-frame entry resets trajectory state — user opened a non-trajectory
    // file (or the underlying parseStructureFile path was taken).
    this.trajectory = null;
    this.currentFrameIndex = 0;
    this.bondParams.clear();
    this.selectedAtoms = [];
    this.clearMeasurements();
    this.updateAxisIndicator();
    this.rebuild();
  }

  /**
   * v0.17 trajectory entry. Stores the trajectory + renders frame 0 with
   * the full reset (bondParams, selection, etc.). Subsequent frame changes
   * use setFrame() which is a lighter swap.
   */
  loadTrajectory(traj: CrystalTrajectory) {
    if (traj.frames.length === 0) return;
    this.trajectory = traj;
    this.currentFrameIndex = 0;
    // Full reset on initial load — same as loadStructure for first frame.
    this.structure = traj.frames[0];
    this.bondParams.clear();
    this.selectedAtoms = [];
    this.clearMeasurements();
    this.updateAxisIndicator();
    this.rebuild();
  }

  /**
   * Swap to a different trajectory frame. Lightweight: preserves bondParams
   * (settings), selectedAtoms (atom-index stable across frames), and
   * measurements. Only rebuilds the atom geometry. Cell wireframe + axis
   * indicator are recomputed only when latticeMode='per-frame'.
   *
   * Bond recomputation honors `recomputeBondsPerFrame` — default false
   * (first-frame bonds inherited; cheap setFrame). When true, full
   * O(N) bond detection runs per frame.
   *
   * No-ops when trajectory absent or index out of range.
   */
  setFrame(index: number): void {
    if (!this.trajectory) return;
    const clamped = Math.max(0, Math.min(index, this.trajectory.frames.length - 1));
    if (clamped === this.currentFrameIndex) return;
    this.currentFrameIndex = clamped;
    this.structure = this.trajectory.frames[clamped];
    if (this.trajectory.latticeMode === 'per-frame') {
      this.updateAxisIndicator();
    }
    this.rebuild(false, !this.recomputeBondsPerFrame);
    // 17.3.1 frame-aware comparison: re-match against the same secondary
    // phase using new primary positions.
    if (this.comparisonActive) this.recomputeComparison();
  }

  // 17.1.5: trajectory bond-recompute toggle.
  setRecomputeBondsPerFrame(b: boolean): void { this.recomputeBondsPerFrame = b; }
  getRecomputeBondsPerFrame(): boolean { return this.recomputeBondsPerFrame; }

  /** Cheap helper for UI gating (used by 17.1.5 auto-disable threshold). */
  getAtomCount(): number {
    return this.structure ? this.structure.species.length : 0;
  }

  // 17.2 multi-phase overlay API.
  addPhase(struct: CrystalStructure, offset: [number, number, number] = [0, 0, 0], opacity = 0.5): void {
    this.secondaryPhases.push({ struct, offset, opacity });
    this.rebuildSecondaryPhases();
  }

  clearPhases(): void {
    this.secondaryPhases = [];
    // Comparison depends on the first secondary phase — clear it too.
    if (this.comparisonActive) this.clearComparison();
    this.rebuildSecondaryPhases();
  }

  getPhaseCount(): number { return this.secondaryPhases.length; }

  /** Per-phase introspection for the side-panel UI list rendering (17.2.1). */
  getPhases(): Array<{ atomCount: number; opacity: number; visible: boolean }> {
    return this.secondaryPhases.map(p => ({
      atomCount: p.struct.species.length,
      opacity: p.opacity,
      visible: (p as any)._visible !== false,
    }));
  }

  setPhaseVisible(idx: number, visible: boolean): void {
    if (idx < 0 || idx >= this.secondaryPhases.length) return;
    (this.secondaryPhases[idx] as any)._visible = visible;
    this.rebuildSecondaryPhases();
  }

  setPhaseOpacity(idx: number, opacity: number): void {
    if (idx < 0 || idx >= this.secondaryPhases.length) return;
    this.secondaryPhases[idx].opacity = Math.max(0, Math.min(1, opacity));
    this.rebuildSecondaryPhases();
  }

  removePhase(idx: number): void {
    if (idx < 0 || idx >= this.secondaryPhases.length) return;
    const wasFirst = (idx === 0);
    this.secondaryPhases.splice(idx, 1);
    // Comparison binds to phase[0] — if we removed it (or removed any phase
    // when comparison was active and only one remained), clear comparison.
    if (this.comparisonActive && (wasFirst || this.secondaryPhases.length === 0)) {
      this.clearComparison();
    }
    this.rebuildSecondaryPhases();
  }

  // 17.3 comparison mode API.
  compareToPhase(): { ok: boolean; reason?: string } {
    if (this.secondaryPhases.length === 0) {
      return { ok: false, reason: 'no secondary phase — run "MatViz: Add Phase" first' };
    }
    if (this.getAtomCount() > 5000) {
      return { ok: false, reason: 'atom count > 5000 — comparison disabled for perf' };
    }
    this.comparisonActive = true;
    this.comparisonSecondaryPhase = this.secondaryPhases[0];
    this.recomputeComparison();
    return { ok: true };
  }

  clearComparison(): void {
    this.comparisonActive = false;
    this.comparisonSecondaryPhase = null;
    this.lastComparisonStats = null;
    this.displacementArrowRenderer.clear();
    this.requestRender();
  }

  isComparisonActive(): boolean { return this.comparisonActive; }

  /** 17.2.3: latest comparison statistics, recomputed each setFrame +
   *  compareToPhase. Null when comparison is inactive. */
  getComparisonStats(): ComparisonStats | null { return this.lastComparisonStats; }

  private recomputeComparison(): void {
    if (!this.comparisonActive || !this.comparisonSecondaryPhase || !this.structure) return;
    const sec = this.comparisonSecondaryPhase;
    // Apply phase offset to secondary positions so matching lives in the
    // same world space the user sees (primary cartesian + offset-shifted
    // secondary cartesian).
    const secPos: [number, number, number][] = sec.struct.positions.map(p => [
      p[0] + sec.offset[0],
      p[1] + sec.offset[1],
      p[2] + sec.offset[2],
    ]);
    // 17.2.2 PBC-aware matching: pass primary lattice when both structures
    // share the same lattice (object identity → trajectory fixed-cell or
    // user comparing variants of the same crystal). Cell-mismatched cases
    // (e.g. relaxed vs unrelaxed lattice constants) fall back to raw
    // cartesian — minimum-image with mismatched cells is ill-defined.
    const sameLattice = this.structure.lattice === sec.struct.lattice;
    const lattice = sameLattice ? this.structure.lattice : undefined;
    const result = matchByNN(
      this.structure.species,
      this.structure.positions,
      sec.struct.species,
      secPos,
      undefined,           // threshold default
      lattice,
    );
    this.displacementArrowRenderer.rebuild(result.pairs, this.structure.positions);
    // 17.2.3 stats: RMSD + magnitude statistics over matched pairs.
    this.lastComparisonStats = computeComparisonStats(result.pairs, result.unmatched.length);
    this.requestRender();
  }

  private rebuildSecondaryPhases(): void {
    // Clear group + dispose per-phase materials/geometries (they're owned
    // here, not via this.materials registry, since they're tied to the
    // phase lifecycle independently of buildVisuals).
    for (const child of [...this.secondaryPhasesGroup.children]) {
      this.secondaryPhasesGroup.remove(child);
      const mesh = child as THREE.InstancedMesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.MeshPhongMaterial;
      if (m && typeof m.dispose === 'function') m.dispose();
    }
    if (this.secondaryPhases.length === 0) {
      this.requestRender();
      return;
    }
    const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
    // We share one geometry across all phases; lifetime ends when next
    // rebuildSecondaryPhases disposes it (above loop catches it through
    // the InstancedMesh.geometry chain).
    for (const phase of this.secondaryPhases) {
      // 17.2.1 visibility toggle: per-phase _visible flag (lazy field on the
      // phase object). When false, skip rebuild for this phase entirely.
      if ((phase as any)._visible === false) continue;
      const groups = new Map<string, number[]>();
      for (let i = 0; i < phase.struct.species.length; i++) {
        const s = phase.struct.species[i];
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s)!.push(i);
      }
      for (const [el, indices] of groups) {
        const elData = getElement(el);
        const color = this.getElementColor(el);
        const mat = new THREE.MeshPhongMaterial({
          color: new THREE.Color(color),
          shininess: 30,
          transparent: true,
          opacity: phase.opacity,
          depthWrite: false,
        });
        const mesh = new THREE.InstancedMesh(sphereGeo, mat, indices.length);
        const dummy = new THREE.Object3D();
        const r = elData.displayRadius;
        for (let k = 0; k < indices.length; k++) {
          const idx = indices[k];
          const p = phase.struct.positions[idx];
          dummy.position.set(p[0] + phase.offset[0], p[1] + phase.offset[1], p[2] + phase.offset[2]);
          dummy.scale.setScalar(r);
          dummy.updateMatrix();
          mesh.setMatrixAt(k, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.renderOrder = 1; // after opaque atoms for correct alpha blending
        this.secondaryPhasesGroup.add(mesh);
      }
    }
    this.requestRender();
  }

  getFrameCount(): number {
    return this.trajectory ? this.trajectory.frames.length : (this.structure ? 1 : 0);
  }

  getCurrentFrame(): number { return this.currentFrameIndex; }

  /** True only for multi-frame trajectories (frames > 1). UI uses this to
   *  surface the playback section. */
  hasTrajectory(): boolean {
    return this.trajectory !== null && this.trajectory.frames.length > 1;
  }

  setSupercell(sc: [number, number, number]) {
    this.supercell = sc;
    if (this.structure) {
      this.selectedAtoms = [];
      this.clearMeasurements();
      this.rebuild();
    }
  }

  toggleBonds() {
    this.showBonds = !this.showBonds;
    if (this.showBonds && this.bondRenderer.group.children.length === 0 && this.cachedBonds.length > 0) {
      this.buildVisuals();
      return;
    }
    this.bondRenderer.setVisible(this.showBonds && this.displayStyle !== 'space-filling');
    this.requestRender();
  }

  resetCamera() {
    if (!this.structure) return;
    this.fitCamera();
    this.requestRender();
  }

  setDisplayStyle(style: DisplayStyle) {
    if (style === this.displayStyle) return;
    this.displayStyle = style;
    if (this.structure) this.buildVisuals();
  }

  getDisplayStyle(): DisplayStyle { return this.displayStyle; }

  setCameraMode(mode: CameraMode) {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;
    const oldCam = this.activeCamera;
    this.activeCamera = mode === 'orthographic' ? this.orthoCamera : this.perspCamera;
    this.activeCamera.position.copy(oldCam.position);
    (this.activeCamera as THREE.Camera).lookAt(this.controls.target);
    this.controls.object = this.activeCamera;
    this.controls.update();
    const orthoNow = (mode === 'orthographic');
    if (this.currentImpostorMaterial) this.currentImpostorMaterial.uniforms.uOrtho.value = orthoNow;
    if (this.bondImpostorMaterial) this.bondImpostorMaterial.uniforms.uOrtho.value = orthoNow;
    this.pickingRenderer.setOrtho(orthoNow);
    this.requestRender();
  }

  getCameraMode(): CameraMode { return this.cameraMode; }

  setImpostorEnabled(enabled: boolean) {
    if (enabled === this.impostorEnabled) return;
    this.impostorEnabled = enabled;
    if (this.structure) this.buildVisuals();
  }

  getImpostorEnabled(): boolean { return this.impostorEnabled; }

  // 16.1 thermal ellipsoids — toggle and probability-contour API.
  setShowEllipsoids(enabled: boolean) {
    if (enabled === this.showEllipsoids) return;
    this.showEllipsoids = enabled;
    if (this.structure) this.buildVisuals();
  }

  getShowEllipsoids(): boolean { return this.showEllipsoids; }

  setProbabilityContour(c: ProbabilityContour) {
    if (c === this.ellipsoidRenderer.getProbabilityContour()) return;
    this.ellipsoidRenderer.setProbabilityContour(c);
    if (this.structure && this.showEllipsoids) this.buildVisuals();
  }

  getProbabilityContour(): ProbabilityContour { return this.ellipsoidRenderer.getProbabilityContour(); }

  /**
   * Whether the loaded structure has any anisotropic-displacement data.
   * Used by the UI to enable/disable the ellipsoid toggle.
   */
  hasThermalAniso(): boolean {
    return !!this.structure?.thermalAniso?.some(u => u !== null);
  }

  // 16.2 partial occupancy — toggle and helper.
  setShowPartialOccupancy(enabled: boolean) {
    if (enabled === this.showPartialOccupancy) return;
    this.showPartialOccupancy = enabled;
    if (this.structure) this.buildVisuals();
  }

  getShowPartialOccupancy(): boolean { return this.showPartialOccupancy; }

  /**
   * Whether the loaded structure has any partial-occupancy site.
   * Used by the UI to enable/disable the "Partial occupancy" toggle.
   */
  hasPartialOccupancy(): boolean {
    return !!this.structure?.occupancy?.some(o => o < 1.0 - 1e-6);
  }

  // 16.3 magnetic moments — toggle, colormap, and helper.
  setShowMagneticMoments(enabled: boolean) {
    if (enabled === this.showMagneticMoments) return;
    this.showMagneticMoments = enabled;
    if (this.structure) this.buildVisuals();
  }

  getShowMagneticMoments(): boolean { return this.showMagneticMoments; }

  setMagneticColormap(c: MagColormap) {
    if (c === this.magneticArrowRenderer.getColormap()) return;
    this.magneticArrowRenderer.setColormap(c);
    if (this.structure && this.showMagneticMoments) this.buildVisuals();
  }

  getMagneticColormap(): MagColormap { return this.magneticArrowRenderer.getColormap(); }

  /**
   * Whether the loaded structure carries any non-zero magnetic moment.
   * Used by the UI to surface the magnetic-moments section.
   */
  hasMagneticMoments(): boolean {
    return !!this.structure?.magMom?.some(m => m[0] !== 0 || m[1] !== 0 || m[2] !== 0);
  }

  // 16.4 Wulff construction — command-palette entry. Caller provides
  // (h, k, l, γ) tuples; renderer transforms via lattice basis and
  // builds the polytope. Throws if planes don't bound a region.
  setWulff(planes: Array<{ h: number; k: number; l: number; gamma: number }>): void {
    this.clearWulff();
    if (!this.structure || planes.length === 0) return;
    const wulffPlanes = planesFromMillerIndices(planes, this.structure.lattice);
    // Bounding-box fallback size: scale by max Wulff distance × 4 so the
    // box never accidentally clips the user-defined polytope.
    const maxDist = Math.max(...planes.map(p => p.gamma));
    const boxSize = Math.max(maxDist * 4, 5);
    const geo = computeWulffGeometry(wulffPlanes, boxSize);
    this.geometries.push(geo);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x4dabf7,
      shininess: 60,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    // Wireframe edges for clarity
    const edges = new THREE.EdgesGeometry(geo);
    this.geometries.push(edges);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x1971c2, linewidth: 2 });
    this.materials.push(edgeMat);
    const wireframe = new THREE.LineSegments(edges, edgeMat);
    this.wulffGroup.add(mesh, wireframe);
    this.currentWulffPlanes = planes.slice();
    this.requestRender();
  }

  clearWulff(): void {
    for (const child of [...this.wulffGroup.children]) {
      this.wulffGroup.remove(child);
    }
    this.currentWulffPlanes = null;
    this.requestRender();
  }

  hasWulff(): boolean {
    return this.currentWulffPlanes !== null;
  }

  toggleLabels() {
    this.showLabels = !this.showLabels;
    if (this.showLabels && this.labelGroup.children.length === 0 && this.expandedSpecies.length > 0) {
      this.buildLabels();
    }
    this.labelGroup.visible = this.showLabels;
    this.requestRender();
  }

  togglePolyhedra() {
    this.showPolyhedra = !this.showPolyhedra;
    if (this.showPolyhedra && this.polyhedraGroup.children.length === 0 && this.cachedBonds.length > 0) {
      this.buildPolyhedra();
    }
    this.polyhedraGroup.visible = this.showPolyhedra;
    this.requestRender();
  }

  toggleBoundaryAtoms() {
    this.showBoundaryAtoms = !this.showBoundaryAtoms;
    if (this.structure) this.rebuild(false);
  }

  getShowBoundaryAtoms(): boolean { return this.showBoundaryAtoms; }

  toggleCellDash() {
    this.showCellDash = !this.showCellDash;
    // Find and toggle visibility of dashed line objects in cellGroup
    for (const child of this.cellGroup.children) {
      if ((child as THREE.LineSegments).material instanceof THREE.LineDashedMaterial) {
        child.visible = this.showCellDash;
      }
    }
    this.requestRender();
  }

  getShowCellDash(): boolean { return this.showCellDash; }

  setAxisIndicatorSize(size: number) {
    this.axisIndicator.setSize(size);
    this.requestRender();
  }

  getAxisIndicatorSize(): number { return this.axisIndicator.size; }

  /** Indicator's CSS-pixel bounding rect (top-down origin) — used by the
   *  pointer hit-test in main.ts for right-click drag. */
  getAxisIndicatorRect(): { x: number; y: number; w: number; h: number } {
    const c = this.canvas;
    return this.axisIndicator.getRect(c.clientWidth, c.clientHeight);
  }

  setAxisIndicatorOffset(dx: number, dy: number) {
    this.axisIndicator.setOffset(dx, dy);
    this.requestRender();
  }

  getAxisIndicatorOffset(): { dx: number; dy: number } { return this.axisIndicator.offset; }

  resetAxisIndicatorOffset() {
    this.axisIndicator.resetOffset();
    this.requestRender();
  }

  private get axisInsetSize(): number { return this.axisIndicator.size; }
  private set axisInsetSize(px: number) { this.axisIndicator.setSize(px); }

  setBondStyle(style: BondStyle) {
    if (style === this.bondStyle) return;
    this.bondStyle = style;
    if (this.structure) this.buildVisuals();
  }

  updateBondCutoff(pair: string, min: number, max: number) {
    const existing = this.bondParams.get(pair);
    this.bondParams.set(pair, { min, max, enabled: existing?.enabled !== false });
    if (this.structure) {
      this.cachedBonds = this.detectBonds(this.expandedSpecies, this.expandedPositions);
      this.buildVisuals();
    }
  }

  getBondParams(): Map<string, BondParams> { return this.bondParams; }

  setBondPairEnabled(pair: string, enabled: boolean) {
    const params = this.bondParams.get(pair);
    if (params) {
      params.enabled = enabled;
      if (this.structure) {
        this.cachedBonds = this.detectBonds(this.expandedSpecies, this.expandedPositions);
        this.buildVisuals();
      }
    }
  }

  // --- Element property overrides ---

  setElementColor(element: string, color: string) {
    this.elementColorOverrides.set(element, color);
    this.materialCache.clear();
    if (this.structure) this.buildVisuals();
  }

  setElementRadius(element: string, radius: number) {
    this.elementRadiusOverrides.set(element, radius);
    if (this.structure) this.buildVisuals();
  }

  setElementVisibility(element: string, visible: boolean) {
    this.elementVisibility.set(element, visible);
    if (this.structure) this.buildVisuals();
  }

  getElementColor(element: string): string {
    return this.elementColorOverrides.get(element) || getElementPaletteColor(element, this.colorPalette);
  }

  getElementRadius(element: string): number {
    return this.elementRadiusOverrides.get(element) || getElement(element).displayRadius;
  }

  getElementVisibility(element: string): boolean {
    return this.elementVisibility.get(element) !== false;
  }

  /** Returns the unique elements present in the current structure */
  getElements(): string[] {
    if (!this.structure) return [];
    return [...new Set(this.structure.species)];
  }

  /** Returns all bond pairs with their current parameters */
  getBondPairs(): { pair: string; min: number; max: number; enabled: boolean }[] {
    const result: { pair: string; min: number; max: number; enabled: boolean }[] = [];
    for (const [pair, params] of this.bondParams) {
      result.push({ pair, min: params.min, max: params.max, enabled: params.enabled });
    }
    return result;
  }

  updateTheme() {
    const bg = this.getBackgroundColor();
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(bg);
    }
    this.requestRender();
  }

  setColorPalette(palette: ColorPalette) {
    if (palette === this.colorPalette) return;
    this.colorPalette = palette;
    if (this.structure) {
      this.rebuild(false);  // buildVisuals rebuilds iso too
    } else if (this.volumetricData) {
      this.buildIsosurface();
    }
    this.requestRender();
  }

  getColorPalette(): ColorPalette {
    return this.colorPalette;
  }

  setAtomSelectCallback(cb: typeof this.onAtomSelect) { this.onAtomSelect = cb; }
  setMeasurementCallback(cb: typeof this.onMeasurement) { this.onMeasurement = cb; }

  clearMeasurements() {
    for (const m of this.measurements) {
      for (const obj of m.objects) {
        this.measureGroup.remove(obj);
      }
    }
    this.measurements = [];
    this.requestRender();
  }

  clearSelection() {
    this.selectedAtoms = [];
    this.updateSelectionHighlight();
    this.requestRender();
  }

  setInteractionMode(mode: 'navigate' | 'measure') {
    if (mode === this.interactionMode) return;
    this.interactionMode = mode;
    this.selectedAtoms = [];
    this.clearMeasurements();
    this.updateSelectionHighlight();
  }

  getInteractionMode(): 'navigate' | 'measure' {
    return this.interactionMode;
  }

  // --- Lattice planes ---

  addLatticePlane(hkl: [number, number, number], distance?: number) {
    if (!this.structure) return;
    const lat = this.structure.lattice;
    const a = new THREE.Vector3(...lat[0]);
    const b = new THREE.Vector3(...lat[1]);
    const c = new THREE.Vector3(...lat[2]);
    const vol = a.dot(b.clone().cross(c));

    // Reciprocal lattice vectors
    const astar = b.clone().cross(c).multiplyScalar(2 * Math.PI / vol);
    const bstar = c.clone().cross(a).multiplyScalar(2 * Math.PI / vol);
    const cstar = a.clone().cross(b).multiplyScalar(2 * Math.PI / vol);

    const normal = astar.clone().multiplyScalar(hkl[0])
      .add(bstar.clone().multiplyScalar(hkl[1]))
      .add(cstar.clone().multiplyScalar(hkl[2]));
    const dSpacing = 2 * Math.PI / normal.length();
    normal.normalize();

    const d = distance ?? dSpacing;

    // Create plane at specified distance along normal
    const center = normal.clone().multiplyScalar(d);
    const size = Math.max(a.length(), b.length(), c.length()) * Math.max(...this.supercell) * 1.5;
    const planeGeo = new THREE.PlaneGeometry(size, size);
    this.geometries.push(planeGeo);

    const colors = [0x4444ff, 0xff4444, 0x44ff44, 0xff44ff, 0xffff44, 0x44ffff];
    const colorIdx = this.planeGroup.children.length % colors.length;

    const planeMat = this.trackMat(new THREE.MeshPhongMaterial({
      color: colors[colorIdx],
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    }));

    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.position.copy(center);
    planeMesh.lookAt(center.clone().add(normal));
    this.planeGroup.add(planeMesh);
    this.requestRender();
  }

  clearLatticePlanes() {
    this.clearGroup(this.planeGroup);
    this.requestRender();
  }

  // --- Volumetric / Isosurface ---

  private volumetricData: VolumetricData | null = null;
  private isoLevel = 0;

  loadVolumetric(data: { origin: [number, number, number]; lattice: [number, number, number][]; dims: [number, number, number]; data: number[] }) {
    this.volumetricData = {
      origin: data.origin,
      lattice: data.lattice,
      dims: data.dims,
      data: new Float32Array(data.data),
    };
    // Auto set iso level to 10% of max value
    let maxVal = 0;
    let minVal = 0;
    for (let i = 0; i < this.volumetricData.data.length; i++) {
      const v = this.volumetricData.data[i];
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    }
    this.isoLevel = maxVal * 0.1;
    this.buildIsosurface();
  }

  setIsoLevel(level: number) {
    this.isoLevel = level;
    this.buildIsosurface();
  }

  getIsoLevel(): number { return this.isoLevel; }

  getIsoRange(): { min: number; max: number } | null {
    if (!this.volumetricData) return null;
    let maxVal = 0;
    for (let i = 0; i < this.volumetricData.data.length; i++) {
      const v = Math.abs(this.volumetricData.data[i]);
      if (v > maxVal) maxVal = v;
    }
    return { min: 0, max: maxVal };
  }

  private buildIsosurface() {
    this.clearGroup(this.isoGroup);
    if (!this.volumetricData) return;
    if (this.isoLevel <= 0) { this.requestRender(); return; }

    const vd = this.volumetricData;
    const sc = this.supercell;

    // Tile the volumetric data (PBC) to fill the supercell so MC runs once
    // over continuous values — inner cell boundaries become seamless.
    const tiled = tileVolumetricPBC(vd.data, vd.dims, sc);
    const scLat: [number, number, number][] = [
      [vd.lattice[0][0] * sc[0], vd.lattice[0][1] * sc[0], vd.lattice[0][2] * sc[0]],
      [vd.lattice[1][0] * sc[1], vd.lattice[1][1] * sc[1], vd.lattice[1][2] * sc[1]],
      [vd.lattice[2][0] * sc[2], vd.lattice[2][1] * sc[2], vd.lattice[2][2] * sc[2]],
    ];

    const [Nx, Ny, Nz] = tiled.dims;
    const uStepA: [number, number, number] = [scLat[0][0] / Nx, scLat[0][1] / Nx, scLat[0][2] / Nx];
    const vStepB: [number, number, number] = [scLat[1][0] / Ny, scLat[1][1] / Ny, scLat[1][2] / Ny];
    const wStepC: [number, number, number] = [scLat[2][0] / Nz, scLat[2][1] / Nz, scLat[2][2] / Nz];

    // Outward face normals (a × b, etc., normalized)
    const cross = (a: number[], b: number[]): [number, number, number] => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const norm = (v: [number, number, number]): [number, number, number] => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const nAB = norm(cross(scLat[0], scLat[1]));  // +c face normal (outward at iz=Nz side)
    const nBC = norm(cross(scLat[1], scLat[2]));  // +a face (ix=Nx)
    const nCA = norm(cross(scLat[2], scLat[0]));  // +b face (iy=Ny)

    const addLobe = (level: number, color: number, fillBelow: boolean) => {
      const mat = this.trackMat(new THREE.MeshPhongMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }));

      // --- Marching cubes on tiled data (pbc=true so iso reaches cell boundary) ---
      const mc = marchingCubes(tiled.data, tiled.dims, vd.origin, scLat, level, true);
      if (mc.positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(mc.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(mc.normals, 3));
        this.geometries.push(geo);
        this.isoGroup.add(new THREE.Mesh(geo, mat));
      }

      // --- Caps on the 6 outer supercell faces ---
      // Extract 2D slice `slice[iu * nv + iv]` at a fixed index along one axis.
      const sliceAxis = (fixedAxis: 0 | 1 | 2, fixedIdx: number): Float32Array => {
        if (fixedAxis === 0) {
          const out = new Float32Array(Ny * Nz);
          for (let iy = 0; iy < Ny; iy++) for (let iz = 0; iz < Nz; iz++) out[iy * Nz + iz] = tiled.data[fixedIdx * Ny * Nz + iy * Nz + iz];
          return out;
        } else if (fixedAxis === 1) {
          const out = new Float32Array(Nx * Nz);
          for (let ix = 0; ix < Nx; ix++) for (let iz = 0; iz < Nz; iz++) out[ix * Nz + iz] = tiled.data[ix * Ny * Nz + fixedIdx * Nz + iz];
          return out;
        } else {
          const out = new Float32Array(Nx * Ny);
          for (let ix = 0; ix < Nx; ix++) for (let iy = 0; iy < Ny; iy++) out[ix * Ny + iy] = tiled.data[ix * Ny * Nz + iy * Nz + fixedIdx];
          return out;
        }
      };

      const origin = vd.origin as [number, number, number];
      const faces: Array<{
        data: Float32Array;
        dims: [number, number];
        origin: [number, number, number];
        uStep: [number, number, number];
        vStep: [number, number, number];
        normal: [number, number, number];
      }> = [
        // -a (ix = 0): u=b, v=c, outward = -nBC
        { data: sliceAxis(0, 0), dims: [Ny, Nz], origin: origin, uStep: vStepB, vStep: wStepC, normal: [-nBC[0], -nBC[1], -nBC[2]] },
        // +a: PBC makes data[Nx] = data[0]; place cap at origin + scLat[0]
        { data: sliceAxis(0, 0), dims: [Ny, Nz], origin: [origin[0] + scLat[0][0], origin[1] + scLat[0][1], origin[2] + scLat[0][2]], uStep: vStepB, vStep: wStepC, normal: nBC },
        // -b (iy = 0): iu=ix (uStep=a), iv=iz (vStep=c)
        { data: sliceAxis(1, 0), dims: [Nx, Nz], origin: origin, uStep: uStepA, vStep: wStepC, normal: [-nCA[0], -nCA[1], -nCA[2]] },
        // +b: PBC
        { data: sliceAxis(1, 0), dims: [Nx, Nz], origin: [origin[0] + scLat[1][0], origin[1] + scLat[1][1], origin[2] + scLat[1][2]], uStep: uStepA, vStep: wStepC, normal: nCA },
        // -c (iz = 0): u=a, v=b
        { data: sliceAxis(2, 0), dims: [Nx, Ny], origin: origin, uStep: uStepA, vStep: vStepB, normal: [-nAB[0], -nAB[1], -nAB[2]] },
        // +c: PBC
        { data: sliceAxis(2, 0), dims: [Nx, Ny], origin: [origin[0] + scLat[2][0], origin[1] + scLat[2][1], origin[2] + scLat[2][2]], uStep: uStepA, vStep: vStepB, normal: nAB },
      ];

      for (const f of faces) {
        // Remap layout: sliceAxis builds data[iu * nv + iv] but the order
        // of nu/nv depends on which two axes we chose — already matches `dims` above.
        const cap = marchingSquaresFill(f.data, f.dims, f.origin, f.uStep, f.vStep, level, f.normal, fillBelow);
        if (cap.positions.length === 0) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(cap.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(cap.normals, 3));
        this.geometries.push(geo);
        this.isoGroup.add(new THREE.Mesh(geo, mat));
      }
    };

    addLobe(this.isoLevel, this.paletteColors().isoPos, false);
    addLobe(-this.isoLevel, this.paletteColors().isoNeg, true);

    this.requestRender();
  }

  // --- Info panel data ---

  getStructureInfo(): {
    spaceGroup: string;
    formula: string;
    volume: number;
    cellParams: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number } | null;
    atomCount: number;
  } | null {
    if (!this.structure) return null;
    const lat = this.structure.lattice;
    const a = new THREE.Vector3(...lat[0]);
    const b = new THREE.Vector3(...lat[1]);
    const c = new THREE.Vector3(...lat[2]);
    const volume = Math.abs(a.dot(b.clone().cross(c)));

    // Chemical formula
    const counts = new Map<string, number>();
    for (const s of this.structure.species) {
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    const formula = [...counts.entries()].map(([el, n]) => n > 1 ? `${el}${n}` : el).join('');

    return {
      spaceGroup: this.structure.spaceGroup || 'P1',
      formula,
      volume,
      cellParams: this.structure.cellParams || null,
      atomCount: this.structure.species.length,
    };
  }

  // --- Screenshot export ---

  exportScreenshot(scale = 2): string {
    const w = this.canvas.clientWidth * scale;
    const h = this.canvas.clientHeight * scale;
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, this.activeCamera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.requestRender();
    return dataUrl;
  }

  // --- State persistence ---

  getState(): {
    schemaVersion: 1;
    displayStyle: DisplayStyle;
    cameraMode: CameraMode;
    showBonds: boolean;
    showLabels: boolean;
    showPolyhedra: boolean;
    showBoundaryAtoms: boolean;
    showCellDash: boolean;
    supercell: [number, number, number];
    cameraPosition: [number, number, number];
    controlsTarget: [number, number, number];
    orthoZoom: number;
    colorPalette: ColorPalette;
    axisIndicatorSize: number;
    isoLevel: number;
    forceBonds: boolean;
    elementColorOverrides: { [k: string]: string };
    elementRadiusOverrides: { [k: string]: number };
    elementVisibility: { [k: string]: boolean };
    bondOverrides: { [pair: string]: { min: number; max: number; enabled: boolean } };
    impostorEnabled: boolean;
    polyhedraCenters: string[];
    showEllipsoids: boolean;
    probabilityContour: ProbabilityContour;
    showPartialOccupancy: boolean;
    showMagneticMoments: boolean;
    magneticColormap: MagColormap;
  } {
    const pos = this.activeCamera.position;
    const target = this.controls.target;
    const bondOverrides: { [k: string]: { min: number; max: number; enabled: boolean } } = {};
    for (const [pair, p] of this.bondParams) bondOverrides[pair] = { min: p.min, max: p.max, enabled: p.enabled };
    return {
      schemaVersion: 1,
      displayStyle: this.displayStyle,
      cameraMode: this.cameraMode,
      showBonds: this.showBonds,
      showLabels: this.showLabels,
      showPolyhedra: this.showPolyhedra,
      showBoundaryAtoms: this.showBoundaryAtoms,
      showCellDash: this.showCellDash,
      supercell: this.supercell,
      cameraPosition: [pos.x, pos.y, pos.z],
      controlsTarget: [target.x, target.y, target.z],
      orthoZoom: this.orthoCamera.zoom,
      colorPalette: this.colorPalette,
      axisIndicatorSize: this.axisInsetSize,
      isoLevel: this.isoLevel,
      forceBonds: this.forceBonds,
      elementColorOverrides: Object.fromEntries(this.elementColorOverrides),
      elementRadiusOverrides: Object.fromEntries(this.elementRadiusOverrides),
      elementVisibility: Object.fromEntries(this.elementVisibility),
      bondOverrides,
      impostorEnabled: this.impostorEnabled,
      polyhedraCenters: [...this.polyhedraCenters],
      showEllipsoids: this.showEllipsoids,
      probabilityContour: this.ellipsoidRenderer.getProbabilityContour(),
      showPartialOccupancy: this.showPartialOccupancy,
      showMagneticMoments: this.showMagneticMoments,
      magneticColormap: this.magneticArrowRenderer.getColormap(),
    };
  }

  restoreState(state: ReturnType<CrystalRenderer['getState']>) {
    if (state.schemaVersion !== 1) return;
    this.displayStyle = state.displayStyle;
    this.showBonds = state.showBonds;
    this.showLabels = state.showLabels;
    // showPolyhedra intentionally NOT restored — always starts off on file
    // init; user opts in per session.
    if (typeof state.showBoundaryAtoms === 'boolean') this.showBoundaryAtoms = state.showBoundaryAtoms;
    if (typeof state.showCellDash === 'boolean') this.showCellDash = state.showCellDash;
    this.supercell = state.supercell;
    if (state.colorPalette) this.colorPalette = state.colorPalette;
    if (typeof state.axisIndicatorSize === 'number') this.axisInsetSize = state.axisIndicatorSize;
    if (typeof state.isoLevel === 'number') this.isoLevel = state.isoLevel;
    if (typeof state.forceBonds === 'boolean') this.forceBonds = state.forceBonds;
    if (state.elementColorOverrides) this.elementColorOverrides = new Map(Object.entries(state.elementColorOverrides));
    if (state.elementRadiusOverrides) this.elementRadiusOverrides = new Map(Object.entries(state.elementRadiusOverrides));
    if (state.elementVisibility) this.elementVisibility = new Map(Object.entries(state.elementVisibility));
    if (state.bondOverrides) {
      for (const [pair, p] of Object.entries(state.bondOverrides)) {
        this.bondParams.set(pair, { min: p.min, max: p.max, enabled: p.enabled });
      }
    }
    // Accept new boolean field; fall back to old tri-state for backwards compat.
    if (typeof state.impostorEnabled === 'boolean') {
      this.impostorEnabled = state.impostorEnabled;
    } else {
      const legacy = (state as unknown as { impostorMode?: string }).impostorMode;
      if (legacy === 'off') this.impostorEnabled = false;
      else if (legacy === 'on' || legacy === 'auto') this.impostorEnabled = true;
    }

    if (Array.isArray(state.polyhedraCenters) && state.polyhedraCenters.length > 0) {
      this.polyhedraCenters = new Set(state.polyhedraCenters);
      this.polyhedraCentersUserSet = true;
    }

    // 16.1: showEllipsoids and probabilityContour are restored across sessions
    // — unlike showPolyhedra which always resets to off. Anisotropic-data
    // structures are intentionally opened with the user's last preference.
    if (typeof state.showEllipsoids === 'boolean') this.showEllipsoids = state.showEllipsoids;
    if (state.probabilityContour === 0.5 || state.probabilityContour === 0.9) {
      this.ellipsoidRenderer.setProbabilityContour(state.probabilityContour);
    }
    if (typeof state.showPartialOccupancy === 'boolean') this.showPartialOccupancy = state.showPartialOccupancy;
    if (typeof state.showMagneticMoments === 'boolean') this.showMagneticMoments = state.showMagneticMoments;
    if (state.magneticColormap === 'redblue' || state.magneticColormap === 'viridis') {
      this.magneticArrowRenderer.setColormap(state.magneticColormap);
    }

    if (state.cameraMode !== this.cameraMode) {
      this.setCameraMode(state.cameraMode);
    }

    this.activeCamera.position.set(...state.cameraPosition);
    this.controls.target.set(...state.controlsTarget);
    this.orthoCamera.zoom = state.orthoZoom;
    this.orthoCamera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  // --- v0.4: Navigation ---

  viewAlongAxis(axis: 'a' | 'b' | 'c' | 'a*' | 'b*' | 'c*') {
    if (!this.structure) return;
    const lat = this.structure.lattice;
    const a = new THREE.Vector3(...lat[0]);
    const b = new THREE.Vector3(...lat[1]);
    const c = new THREE.Vector3(...lat[2]);

    let dir: THREE.Vector3;
    let up: THREE.Vector3;
    switch (axis) {
      case 'a':  dir = a.clone().normalize();  up = c.clone().normalize(); break;
      case 'b':  dir = b.clone().normalize();  up = c.clone().normalize(); break;
      case 'c':  dir = c.clone().normalize();  up = b.clone().normalize(); break;
      case 'a*': dir = b.clone().cross(c).normalize(); up = c.clone().normalize(); break;
      case 'b*': dir = c.clone().cross(a).normalize(); up = c.clone().normalize(); break;
      case 'c*': dir = a.clone().cross(b).normalize(); up = b.clone().normalize(); break;
    }
    this.animateCameraToDirection(dir, up!);
  }

  viewAlongDirection(uvw: [number, number, number]) {
    if (!this.structure) return;
    const lat = this.structure.lattice;
    const dir = new THREE.Vector3(
      uvw[0] * lat[0][0] + uvw[1] * lat[1][0] + uvw[2] * lat[2][0],
      uvw[0] * lat[0][1] + uvw[1] * lat[1][1] + uvw[2] * lat[2][1],
      uvw[0] * lat[0][2] + uvw[1] * lat[1][2] + uvw[2] * lat[2][2],
    ).normalize();
    this.animateCameraToDirection(dir);
  }

  viewNormalToPlane(hkl: [number, number, number]) {
    if (!this.structure) return;
    const lat = this.structure.lattice;
    const a = new THREE.Vector3(...lat[0]);
    const b = new THREE.Vector3(...lat[1]);
    const c = new THREE.Vector3(...lat[2]);
    const vol = a.dot(b.clone().cross(c));
    const astar = b.clone().cross(c).multiplyScalar(2 * Math.PI / vol);
    const bstar = c.clone().cross(a).multiplyScalar(2 * Math.PI / vol);
    const cstar = a.clone().cross(b).multiplyScalar(2 * Math.PI / vol);
    const normal = astar.multiplyScalar(hkl[0])
      .add(bstar.multiplyScalar(hkl[1]))
      .add(cstar.multiplyScalar(hkl[2]))
      .normalize();
    this.animateCameraToDirection(normal);
  }

  rotateCamera(degrees: number, axis: 'x' | 'y' | 'z') {
    const rad = (degrees * Math.PI) / 180;
    const target = this.controls.target.clone();
    const offset = this.activeCamera.position.clone().sub(target);

    let rotAxis: THREE.Vector3;
    if (axis === 'y') {
      // World up (c-axis direction when in standard orientation)
      rotAxis = this.activeCamera.up.clone().normalize();
    } else if (axis === 'x') {
      // Screen-right axis
      rotAxis = new THREE.Vector3().setFromMatrixColumn(this.activeCamera.matrix, 0);
    } else {
      // Screen-Z (forward axis) for CW/CCW rotation
      rotAxis = offset.clone().normalize();
    }

    const q = new THREE.Quaternion().setFromAxisAngle(rotAxis, rad);
    offset.applyQuaternion(q);

    // For Z-axis rotation, also rotate the up vector
    if (axis === 'z') {
      this.activeCamera.up.applyQuaternion(q);
    }

    this.activeCamera.position.copy(target).add(offset);
    this.activeCamera.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  zoom(factor: number) {
    if (this.activeCamera instanceof THREE.PerspectiveCamera) {
      this.activeCamera.position.lerp(this.controls.target, 1 - factor);
    } else {
      this.orthoCamera.zoom *= 1 / factor;
      this.orthoCamera.updateProjectionMatrix();
    }
    this.controls.update();
    this.requestRender();
  }

  // --- Free rotation (quaternion-based, no gimbal lock) ---

  private initFreeRotation(canvas: HTMLCanvasElement) {
    let dragging = false;
    let mode: 'free' | 'shift' | 'ctrl' = 'free';
    let startX = 0;
    let startY = 0;
    let lockedAxis: 'x' | 'y' | null = null;
    const baseRotateSpeed = 0.4; // degrees per pixel at reference distance
    const referenceDistance = 20; // initial camera distance
    const getRotateSpeed = () => {
      const dist = this.activeCamera.position.distanceTo(this.controls.target);
      return baseRotateSpeed * (referenceDistance / Math.max(dist, 1));
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // left click only
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      lockedAxis = null;

      if (e.ctrlKey || e.metaKey) {
        mode = 'ctrl';
      } else if (e.shiftKey) {
        mode = 'shift';
      } else {
        mode = 'free';
      }
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      startX = e.clientX;
      startY = e.clientY;

      const rotateSpeed = getRotateSpeed();
      if (mode === 'ctrl') {
        // Ctrl+drag: rotate around screen-Z (roll)
        this.rotateCamera(dx * rotateSpeed, 'z');
      } else if (mode === 'shift') {
        // Shift+drag: lock to single axis
        if (!lockedAxis && (Math.abs(e.clientX - startX + dx) > 5 || Math.abs(e.clientY - startY + dy) > 5)) {
          lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'y' : 'x';
        }
        if (lockedAxis) {
          const delta = lockedAxis === 'y' ? dx : dy;
          this.rotateCamera(delta * rotateSpeed, lockedAxis);
        }
      } else {
        // Free rotation: apply both X and Y rotations via quaternion
        this.rotateCameraFree(dx * rotateSpeed, dy * rotateSpeed);
      }
    });

    const endDrag = () => { dragging = false; lockedAxis = null; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  /** Quaternion-based free rotation — no gimbal lock */
  private rotateCameraFree(degreesX: number, degreesY: number) {
    const target = this.controls.target.clone();
    const offset = this.activeCamera.position.clone().sub(target);

    // Screen-space axes
    const right = new THREE.Vector3().setFromMatrixColumn(this.activeCamera.matrix, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(this.activeCamera.matrix, 1).normalize();

    const qX = new THREE.Quaternion().setFromAxisAngle(up, -degreesX * Math.PI / 180);
    const qY = new THREE.Quaternion().setFromAxisAngle(right, -degreesY * Math.PI / 180);
    const q = qX.multiply(qY);

    offset.applyQuaternion(q);
    this.activeCamera.up.applyQuaternion(q);

    this.activeCamera.position.copy(target).add(offset);
    this.activeCamera.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  // Standard orientation: c-axis up, view from a* direction
  standardOrientation() {
    if (!this.structure) return;
    const lat = this.structure.lattice;
    const a = new THREE.Vector3(...lat[0]);
    const b = new THREE.Vector3(...lat[1]);
    const c = new THREE.Vector3(...lat[2]);

    // c-axis = up
    const up = c.clone().normalize();
    // View direction = a* (perpendicular to b-c plane)
    const viewDir = b.clone().cross(c).normalize();

    this.perspCamera.up.copy(up);
    this.orthoCamera.up.copy(up);

    this.fitCamera();

    // Position camera along a* from center
    const target = this.controls.target.clone();
    const dist = this.activeCamera.position.distanceTo(target);
    const newPos = target.clone().add(viewDir.multiplyScalar(dist));

    this.perspCamera.position.copy(newPos);
    this.orthoCamera.position.copy(newPos);
    this.perspCamera.lookAt(target);
    this.orthoCamera.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  // --- Axis indicator ---

  private initAxisIndicator() { /* handled by AxisIndicator class */ }

  /** Update axis directions when a structure is loaded */
  private updateAxisIndicator() {
    if (!this.structure) return;
    const lat = this.structure.lattice;
    this.axisIndicator.update(lat[0], lat[1], lat[2]);
  }

  // --- On-demand rendering ---

  private requestRender() {
    if (!this.renderRequested) {
      this.renderRequested = true;
      requestAnimationFrame(() => this.renderFrame());
    }
  }

  private renderFrame() {
    this.renderRequested = false;
    this.controls.update();

    if (this.currentImpostorMaterial || this.bondImpostorMaterial) {
      // Transform the scene's two directional lights into view space so
      // impostor shading follows the same lights as Phong atoms/bonds.
      const worldLight = new THREE.Vector3(5, 10, 7).normalize();
      const viewLight = worldLight.clone().transformDirection(this.activeCamera.matrixWorldInverse);
      const worldFill = new THREE.Vector3(-5, -5, -5).normalize();
      const viewFill = worldFill.clone().transformDirection(this.activeCamera.matrixWorldInverse);
      if (this.currentImpostorMaterial) {
        this.currentImpostorMaterial.uniforms.uLightDir.value.copy(viewLight);
        this.currentImpostorMaterial.uniforms.uLightDirFill.value.copy(viewFill);
      }
      if (this.bondImpostorMaterial) {
        this.bondImpostorMaterial.uniforms.uLightDir.value.copy(viewLight);
        this.bondImpostorMaterial.uniforms.uLightDirFill.value.copy(viewFill);
      }
    }

    // Main scene (full viewport)
    this.renderer.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.activeCamera);

    this.axisIndicator.syncToMainCamera(this.activeCamera, this.controls.target);
    this.axisIndicator.render(this.renderer);
  }

  // --- Material cache ---

  private getMaterial(color: string, shininess: number): THREE.MeshPhongMaterial {
    const key = `${color}_${shininess}`;
    let mat = this.materialCache.get(key);
    if (!mat) {
      mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), shininess });
      this.materialCache.set(key, mat);
    }
    return mat;
  }

  private getWireframeMaterial(color: string): THREE.MeshPhongMaterial {
    const key = `${color}_wf`;
    let mat = this.materialCache.get(key);
    if (!mat) {
      mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), wireframe: true });
      this.materialCache.set(key, mat);
    }
    return mat;
  }

  private disposeAllMaterials() {
    for (const mat of this.materialCache.values()) mat.dispose();
    this.materialCache.clear();
    for (const mat of this.materials) mat.dispose();
    this.materials = [];
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  // --- Adaptive LOD ---

  private getSphereSegments(n: number): [number, number] {
    if (n < 500) return [32, 24];
    if (n < 2000) return [16, 12];
    return [8, 6];
  }

  private getCylinderSegments(n: number): number {
    if (n < 500) return 12;
    if (n < 2000) return 8;
    return 6;
  }

  // --- Background ---

  private getBackgroundColor(): number {
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const match = bg.match(/\d+/g);
      if (match && match.length >= 3) {
        return (parseInt(match[0]) << 16) | (parseInt(match[1]) << 8) | parseInt(match[2]);
      }
    } catch { /* ignore */ }
    return 0x1e1e1e;
  }

  /** Get palette-appropriate line colors */
  private paletteColors() {
    return getPaletteLineColors(this.colorPalette);
  }

  // --- Camera animation ---

  private animateCameraToDirection(dir: THREE.Vector3, up?: THREE.Vector3) {
    if (this.animating) return;
    this.animating = true;
    const target = this.controls.target.clone();
    const dist = this.activeCamera.position.distanceTo(target);
    const endPos = target.clone().add(dir.clone().multiplyScalar(dist));
    const startPos = this.activeCamera.position.clone();
    const startUp = this.activeCamera.up.clone();
    const endUp = up ? up.clone() : startUp.clone();
    const startTime = performance.now();
    const duration = 300;

    const step = () => {
      const t = Math.min((performance.now() - startTime) / duration, 1);
      const ease = t * (2 - t);
      this.activeCamera.position.lerpVectors(startPos, endPos, ease);
      this.activeCamera.up.lerpVectors(startUp, endUp, ease).normalize();
      this.activeCamera.lookAt(target);
      this.controls.update();
      this.renderFrame();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.animating = false;
      }
    };
    requestAnimationFrame(step);
  }

  // --- Picking ---

  private onCanvasClick(event: MouseEvent) {
    if (!this.structure || this.expandedPositions.length === 0) return;

    let closestAtomIdx = -1;

    if (this.expandedPositions.length >= GPU_PICK_THRESHOLD) {
      closestAtomIdx = this.pickingRenderer.pickAt(
        event.clientX,
        event.clientY,
        this.canvas,
        this.activeCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
        this.renderer,
      );
    } else {
      const rect = this.canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      this.raycaster.setFromCamera(mouse, this.activeCamera);

      // Intersect all atom meshes
      let closestDist = Infinity;
      for (const entry of this.atomMeshMap) {
        const intersects = this.raycaster.intersectObject(entry.mesh);
        if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
          const d = intersects[0].distance;
          if (d < closestDist) {
            closestDist = d;
            closestAtomIdx = entry.globalIndices[intersects[0].instanceId];
          }
        }
      }
    }

    if (closestAtomIdx >= 0) {
      // Emit atom info — report unit cell index and fractional coords within one unit cell
      if (this.onAtomSelect) {
        const ucIdx = this.expandedUnitCellIndex[closestAtomIdx] ?? closestAtomIdx;
        const ucPos = this.structure!.positions[ucIdx];
        const ucFrac = this.cartesianToFractional(ucPos);
        this.onAtomSelect({
          index: ucIdx,
          element: this.expandedSpecies[closestAtomIdx],
          cartesian: this.expandedPositions[closestAtomIdx],
          fractional: ucFrac,
        });
      }

      if (this.interactionMode === 'navigate') {
        // Navigate mode: single selection, info only
        this.selectedAtoms = [closestAtomIdx];
      } else {
        // Measure mode: accumulate selections for measurements
        this.selectedAtoms.push(closestAtomIdx);
        if (this.selectedAtoms.length === 2) {
          this.addDistanceMeasurement(this.selectedAtoms[0], this.selectedAtoms[1]);
        } else if (this.selectedAtoms.length === 3) {
          this.addAngleMeasurement(this.selectedAtoms[0], this.selectedAtoms[1], this.selectedAtoms[2]);
        } else if (this.selectedAtoms.length >= 4) {
          this.addDihedralMeasurement(this.selectedAtoms[0], this.selectedAtoms[1], this.selectedAtoms[2], this.selectedAtoms[3]);
          this.selectedAtoms = [];
        }
      }

      this.updateSelectionHighlight();
      this.requestRender();
    } else {
      this.selectedAtoms = [];
      this.updateSelectionHighlight();
      if (this.onAtomSelect) this.onAtomSelect(null);
      this.requestRender();
    }
  }

  private updateSelectionHighlight() {
    const selectedSet = new Set(this.selectedAtoms);
    for (const entry of this.atomMeshMap) {
      for (let i = 0; i < entry.globalIndices.length; i++) {
        const isSelected = selectedSet.has(entry.globalIndices[i]);
        entry.mesh.setColorAt(i, isSelected ? CrystalRenderer.HIGHLIGHT_COLOR : entry.baseColor);
      }
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
    }
  }

  private cartesianToFractional(pos: [number, number, number]): [number, number, number] {
    if (!this.structure) return [0, 0, 0];
    const lat = this.structure.lattice;
    // Inverse of 3x3 lattice matrix
    const a = lat[0], b = lat[1], c = lat[2];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1])
              - a[1] * (b[0] * c[2] - b[2] * c[0])
              + a[2] * (b[0] * c[1] - b[1] * c[0]);
    if (Math.abs(det) < 1e-10) return [0, 0, 0];
    const invDet = 1 / det;
    const inv = [
      [(b[1] * c[2] - b[2] * c[1]) * invDet, (a[2] * c[1] - a[1] * c[2]) * invDet, (a[1] * b[2] - a[2] * b[1]) * invDet],
      [(b[2] * c[0] - b[0] * c[2]) * invDet, (a[0] * c[2] - a[2] * c[0]) * invDet, (a[2] * b[0] - a[0] * b[2]) * invDet],
      [(b[0] * c[1] - b[1] * c[0]) * invDet, (a[1] * c[0] - a[0] * c[1]) * invDet, (a[0] * b[1] - a[1] * b[0]) * invDet],
    ];
    // Transpose application: f_i = sum_j inv[j][i] * cart[j]
    return [
      inv[0][0] * pos[0] + inv[1][0] * pos[1] + inv[2][0] * pos[2],
      inv[0][1] * pos[0] + inv[1][1] * pos[1] + inv[2][1] * pos[2],
      inv[0][2] * pos[0] + inv[1][2] * pos[1] + inv[2][2] * pos[2],
    ];
  }

  // --- Measurements ---

  private addDistanceMeasurement(a: number, b: number) {
    const pA = new THREE.Vector3(...this.expandedPositions[a]);
    const pB = new THREE.Vector3(...this.expandedPositions[b]);
    const dist = pA.distanceTo(pB);
    const objects: THREE.Object3D[] = [];

    // Dashed line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([pA, pB]);
    this.geometries.push(lineGeo);
    const lineMat = this.trackMat(new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: 0.2, gapSize: 0.1 }));
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    this.measureGroup.add(line);
    objects.push(line);

    // Label
    const mid = pA.clone().lerp(pB, 0.5);
    const label = this.createMeasurementLabel(`${dist.toFixed(3)} A`);
    label.position.copy(mid).add(new THREE.Vector3(0, 0.3, 0));
    this.measureGroup.add(label);
    objects.push(label);

    const measurement: MeasurementObj = { type: 'distance', atoms: [a, b], value: dist, objects };
    this.measurements.push(measurement);
    if (this.onMeasurement) this.onMeasurement({ type: 'distance', value: dist, atoms: [a, b] });
  }

  private addAngleMeasurement(a: number, b: number, c: number) {
    const pA = new THREE.Vector3(...this.expandedPositions[a]);
    const pB = new THREE.Vector3(...this.expandedPositions[b]);
    const pC = new THREE.Vector3(...this.expandedPositions[c]);
    const vBA = pA.clone().sub(pB).normalize();
    const vBC = pC.clone().sub(pB).normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, vBA.dot(vBC)))) * 180 / Math.PI;
    const objects: THREE.Object3D[] = [];

    // Yellow dashed legs: A—B and B—C (matches distance-measurement style).
    const lineMat = this.trackMat(new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: 0.2, gapSize: 0.1 }));
    for (const [p, q] of [[pA, pB], [pB, pC]] as const) {
      const geo = new THREE.BufferGeometry().setFromPoints([p, q]);
      this.geometries.push(geo);
      const line = new THREE.Line(geo, lineMat);
      line.computeLineDistances();
      this.measureGroup.add(line);
      objects.push(line);
    }

    const label = this.createMeasurementLabel(`${angle.toFixed(1)}\u00B0`);
    label.position.copy(pB).add(new THREE.Vector3(0, 0.4, 0));
    this.measureGroup.add(label);
    objects.push(label);

    const measurement: MeasurementObj = { type: 'angle', atoms: [a, b, c], value: angle, objects };
    this.measurements.push(measurement);
    if (this.onMeasurement) this.onMeasurement({ type: 'angle', value: angle, atoms: [a, b, c] });
  }

  private addDihedralMeasurement(a: number, b: number, c: number, d: number) {
    const p1 = new THREE.Vector3(...this.expandedPositions[a]);
    const p2 = new THREE.Vector3(...this.expandedPositions[b]);
    const p3 = new THREE.Vector3(...this.expandedPositions[c]);
    const p4 = new THREE.Vector3(...this.expandedPositions[d]);
    const b1 = p2.clone().sub(p1);
    const b2 = p3.clone().sub(p2);
    const b3 = p4.clone().sub(p3);
    const n1 = b1.clone().cross(b2).normalize();
    const n2 = b2.clone().cross(b3).normalize();
    const m = n1.clone().cross(b2.clone().normalize());
    const dihedral = Math.atan2(m.dot(n2), n1.dot(n2)) * 180 / Math.PI;
    const objects: THREE.Object3D[] = [];

    // Two dihedral planes as dashed triangle outlines, different colors.
    // Plane 1 = (1,2,3), plane 2 = (2,3,4); shared 2-3 edge shown in both colors.
    const planes: [THREE.Vector3[], number][] = [
      [[p1, p2, p3, p1], 0x00d4ff],  // cyan
      [[p2, p3, p4, p2], 0xff3ec8],  // magenta
    ];
    for (const [pts, color] of planes) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.geometries.push(geo);
      const mat = this.trackMat(new THREE.LineDashedMaterial({ color, dashSize: 0.2, gapSize: 0.1 }));
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      this.measureGroup.add(line);
      objects.push(line);
    }

    const mid = p2.clone().lerp(p3, 0.5);
    const label = this.createMeasurementLabel(`${dihedral.toFixed(1)}\u00B0`);
    label.position.copy(mid).add(new THREE.Vector3(0, 0.4, 0));
    this.measureGroup.add(label);
    objects.push(label);

    const measurement: MeasurementObj = { type: 'dihedral', atoms: [a, b, c, d], value: dihedral, objects };
    this.measurements.push(measurement);
    if (this.onMeasurement) this.onMeasurement({ type: 'dihedral', value: dihedral, atoms: [a, b, c, d] });
  }

  private createMeasurementLabel(text: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    ctx.fillStyle = '#ffff00';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    this.textures.push(tex);
    const mat = this.trackMat(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.4, 1);
    return sprite;
  }

  // --- Rebuild ---

  /**
   * Rebuild the atom/bond/cell visuals from `this.structure`. Two flags:
   *   resetCamera (default true)        — re-fit the camera to new bbox
   *   skipBondsRecompute (default false) — keep `this.cachedBonds` instead
   *     of re-running `detectBonds()`. 17.1.5 trajectory playback path:
   *     setFrame passes true so MD frames inherit frame-0 bond pattern
   *     (cheap O(visualization), not O(detection)).
   */
  private rebuild(resetCamera = true, skipBondsRecompute = false) {
    const struct = this.structure!;
    this.disposeResources();

    const { species, positions } = this.expandSupercell(struct);
    this.expandedSpecies = species;
    this.expandedPositions = positions;

    // Auto-populate bond params for new species pairs
    this.autoPopulateBondParams(species);

    // Detect bonds (cached for style switching). Skipped for trajectory
    // playback when --recompute-bonds-per-frame is off — caller (setFrame)
    // accepts that bonds may be off after large atom motion.
    if (!skipBondsRecompute) {
      this.cachedBonds = this.detectBonds(species, positions);
    }

    // Auto-populate polyhedra centers on first load (unless user/state already set them)
    if (!this.polyhedraCentersUserSet) this.autoDetectPolyhedraCenters();

    // Build unit cell wireframe
    this.buildUnitCell(struct.lattice);

    // Build visual representation
    this.buildVisuals();

    if (resetCamera) this.fitCamera();
    this.requestRender();
  }

  private autoPopulateBondParams(species: string[]) {
    const elements = new Set(species);
    const sorted = [...elements].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i; j < sorted.length; j++) {
        const pair = `${sorted[i]}-${sorted[j]}`;
        if (!this.bondParams.has(pair)) {
          const max = getElement(sorted[i]).covalentRadius + getElement(sorted[j]).covalentRadius + 0.3;
          this.bondParams.set(pair, { min: 0.1, max, enabled: true });
        }
      }
    }
  }

  private buildVisuals() {
    this.clearGroup(this.atomGroup);
    this.clearGroup(this.labelGroup);
    this.clearGroup(this.polyhedraGroup);
    this.atomMeshMap = [];

    const species = this.expandedSpecies;
    const positions = this.expandedPositions;
    const bonds = this.cachedBonds;
    const style = this.displayStyle;

    this.buildAtoms(species, positions, style, bonds);
    this.pickingRenderer.rebuild(this.atomMeshMap, this.impostorEnabled, this.cameraMode === 'orthographic');

    // 16.3 magnetic-moment arrows — overlay, independent of atom dispatch.
    // Looks up moment per expanded atom via expandedUnitCellIndex; arrows
    // are skipped for zero moments (length < 1e-4).
    this.magneticArrowRenderer.clear();
    const mag = this.structure?.magMom;
    if (this.showMagneticMoments && mag && style !== 'wireframe') {
      const arrows: MagneticArrowInstance[] = [];
      for (let i = 0; i < species.length; i++) {
        if (this.elementVisibility.get(species[i]) === false) continue;
        const unitIdx = this.expandedUnitCellIndex[i] ?? i;
        const m = mag[unitIdx];
        if (!m) continue;
        const len = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
        if (len < 1e-4) continue;
        arrows.push({ position: positions[i], moment: m });
      }
      if (arrows.length > 0) this.magneticArrowRenderer.rebuild(arrows);
    }
    this.magneticArrowRenderer.setVisible(this.showMagneticMoments);

    if (style !== 'space-filling' && this.showBonds) {
      this.bondRenderer.rebuild(species, positions, bonds, this.bondStyle, style);
    } else {
      this.bondRenderer.rebuild(species, positions, [], this.bondStyle, style);
    }
    this.bondRenderer.setVisible(this.showBonds && style !== 'space-filling');

    if (this.showLabels) this.buildLabels();
    this.labelGroup.visible = this.showLabels;

    if (this.showPolyhedra) this.buildPolyhedra();
    this.polyhedraGroup.visible = this.showPolyhedra;

    // Isosurface depends on supercell tiling, so rebuild whenever visuals do.
    if (this.volumetricData) this.buildIsosurface();

    this.requestRender();
  }

  // --- Expand supercell ---

  private expandSupercell(struct: CrystalStructure): { species: string[]; positions: [number, number, number][] } {
    const [na, nb, nc] = this.supercell;
    const species: string[] = [];
    const positions: [number, number, number][] = [];
    const unitCellIndex: number[] = [];

    // When boundary mode is on, wrap fractional coords into [0,1)
    // so all atoms appear inside the unit cell.
    const lat = struct.lattice;
    let basePositions = struct.positions;
    if (this.showBoundaryAtoms) {
      basePositions = struct.positions.map(pos => {
        const frac = this.cartesianToFractional(pos);
        const wf: [number, number, number] = [
          ((frac[0] % 1) + 1) % 1,
          ((frac[1] % 1) + 1) % 1,
          ((frac[2] % 1) + 1) % 1,
        ];
        return [
          wf[0] * lat[0][0] + wf[1] * lat[1][0] + wf[2] * lat[2][0],
          wf[0] * lat[0][1] + wf[1] * lat[1][1] + wf[2] * lat[2][1],
          wf[0] * lat[0][2] + wf[1] * lat[1][2] + wf[2] * lat[2][2],
        ] as [number, number, number];
      });
    }

    for (let ia = 0; ia < na; ia++) {
      for (let ib = 0; ib < nb; ib++) {
        for (let ic = 0; ic < nc; ic++) {
          const offset: [number, number, number] = [
            ia * lat[0][0] + ib * lat[1][0] + ic * lat[2][0],
            ia * lat[0][1] + ib * lat[1][1] + ic * lat[2][1],
            ia * lat[0][2] + ib * lat[1][2] + ic * lat[2][2],
          ];
          for (let j = 0; j < struct.species.length; j++) {
            species.push(struct.species[j]);
            positions.push([
              basePositions[j][0] + offset[0],
              basePositions[j][1] + offset[1],
              basePositions[j][2] + offset[2],
            ]);
            unitCellIndex.push(j);
          }
        }
      }
    }

    // Boundary atoms: duplicate atoms on supercell faces/edges/corners
    if (this.showBoundaryAtoms) {
      this.addBoundaryAtoms(struct, species, positions, unitCellIndex);
    }

    this.expandedUnitCellIndex = unitCellIndex;

    return { species, positions };
  }

  /**
   * Boundary atoms on supercell faces/edges/corners.
   *
   * expandSupercell places atoms at cell translations (ia, ib, ic) for
   * ia ∈ [0, na-1]. Boundary atoms are periodic images that sit exactly
   * on the supercell boundary — they arise when a base atom has a
   * fractional coordinate near 0 (≈ integer), so its image at ia=na
   * (or ib=nb, ic=nc) lands on the opposite face.
   *
   * Approach: for each base atom whose fractional coord is near 0 in
   * any axis, add the image at the +N edge for that axis. Only atoms
   * with frac ≈ 0 get boundary copies; atoms at frac=0.33 etc. are
   * interior and are never duplicated.
   */
  private addBoundaryAtoms(
    struct: CrystalStructure,
    species: string[],
    positions: [number, number, number][],
    unitCellIndex: number[],
  ) {
    const tol = 0.02;
    const lat = struct.lattice;
    const [na, nb, nc] = this.supercell;

    // Dedup existing positions
    const seen = new Set<string>();
    for (let i = 0; i < positions.length; i++) {
      const key = `${positions[i][0].toFixed(3)}_${positions[i][1].toFixed(3)}_${positions[i][2].toFixed(3)}`;
      seen.add(key);
    }

    for (let j = 0; j < struct.species.length; j++) {
      const frac = this.cartesianToFractional(struct.positions[j]);
      let [fx, fy, fz] = frac;

      // Wrap to [0, 1) and check if near 0
      fx = ((fx % 1) + 1) % 1; if (fx > 1 - 1e-6) fx = 0;
      fy = ((fy % 1) + 1) % 1; if (fy > 1 - 1e-6) fy = 0;
      fz = ((fz % 1) + 1) % 1; if (fz > 1 - 1e-6) fz = 0;

      const nearA = fx < tol;
      const nearB = fy < tol;
      const nearC = fz < tol;

      if (!nearA && !nearB && !nearC) continue;

      // Generate boundary shifts: for axes where frac ≈ 0, add +N shift
      // Combined with all supercell copies
      const aShifts = nearA ? [0, 1] : [0];
      const bShifts = nearB ? [0, 1] : [0];
      const cShifts = nearC ? [0, 1] : [0];

      for (let ia = 0; ia < na; ia++) {
        for (let ib = 0; ib < nb; ib++) {
          for (let ic = 0; ic < nc; ic++) {
            for (const da of aShifts) {
              for (const db of bShifts) {
                for (const dc of cShifts) {
                  if (da === 0 && db === 0 && dc === 0) continue; // original, already placed

                  const fa = ia + da + fx;
                  const fb = ib + db + fy;
                  const fc = ic + dc + fz;

                  // Boundary image at ia+da=na etc. must stay within [0, N+tol]
                  if (fa > na + tol || fb > nb + tol || fc > nc + tol) continue;

                  const cart: [number, number, number] = [
                    fa * lat[0][0] + fb * lat[1][0] + fc * lat[2][0],
                    fa * lat[0][1] + fb * lat[1][1] + fc * lat[2][1],
                    fa * lat[0][2] + fb * lat[1][2] + fc * lat[2][2],
                  ];

                  const key = `${cart[0].toFixed(3)}_${cart[1].toFixed(3)}_${cart[2].toFixed(3)}`;
                  if (!seen.has(key)) {
                    seen.add(key);
                    species.push(struct.species[j]);
                    positions.push(cart);
                    unitCellIndex.push(j);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // --- Bond detection with spatial hashing + periodic boundary ---

  getBondSkipInfo(): { skipped: boolean; atomCount: number; limit: number; estimateMs: number } {
    const n = this.expandedPositions?.length ?? 0;
    const limit = 5000;
    // Spatial hash is ~O(N); assume ~30 ns/atom on SwiftShader-class hardware.
    const estimateMs = Math.min(10000, Math.round(n * 0.03));
    return { skipped: n > limit && !this.forceBonds, atomCount: n, limit, estimateMs };
  }

  setForceBonds(force: boolean) {
    this.forceBonds = force;
    if (this.structure) {
      this.cachedBonds = this.detectBonds(this.expandedSpecies, this.expandedPositions);
      this.buildVisuals();
    }
  }

  private forceBonds = false;

  private detectBonds(species: string[], positions: [number, number, number][]): BondInfo[] {
    const n = positions.length;
    if (n > 5000 && !this.forceBonds) return [];

    // Find max bond cutoff
    let maxCutoff = 0;
    for (const [, params] of this.bondParams) {
      if (params.max > maxCutoff) maxCutoff = params.max;
    }
    if (maxCutoff === 0) return [];

    const cellSize = maxCutoff;

    // Build cell list (only real/visible atoms)
    const cellMap = new Map<string, number[]>();
    const cellIdx: [number, number, number][] = new Array(n);

    for (let i = 0; i < n; i++) {
      const ix = Math.floor(positions[i][0] / cellSize);
      const iy = Math.floor(positions[i][1] / cellSize);
      const iz = Math.floor(positions[i][2] / cellSize);
      cellIdx[i] = [ix, iy, iz];
      const key = `${ix},${iy},${iz}`;
      let list = cellMap.get(key);
      if (!list) { list = []; cellMap.set(key, list); }
      list.push(i);
    }

    const bonds: BondInfo[] = [];

    for (let i = 0; i < n; i++) {
      const [cix, ciy, ciz] = cellIdx[i];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const neighbors = cellMap.get(`${cix + dx},${ciy + dy},${ciz + dz}`);
            if (!neighbors) continue;
            for (const j of neighbors) {
              if (j <= i) continue;

              const pair = [species[i], species[j]].sort().join('-');
              const params = this.bondParams.get(pair);
              if (!params || !params.enabled) continue;

              const px = positions[j][0] - positions[i][0];
              const py = positions[j][1] - positions[i][1];
              const pz = positions[j][2] - positions[i][2];
              const dist = Math.sqrt(px * px + py * py + pz * pz);

              if (dist >= params.min && dist <= params.max) {
                bonds.push({ i, j, distance: dist });
              }
            }
          }
        }
      }
    }

    return bonds;
  }

  // --- Atom building ---

  private buildAtoms(species: string[], positions: [number, number, number][], style: DisplayStyle, bonds: BondInfo[]) {
    // 16.1 ellipsoid routing: when enabled and the structure carries
    // thermalAniso, peel off atoms with non-null Uᵢⱼ from the regular sphere
    // path and route them to ellipsoidRenderer. Phong is forced (impostor
    // shader assumes uniform radius).
    this.ellipsoidRenderer.clear();
    const ellipsoidIdxSet = new Set<number>();
    const ellipsoidGroups = new Map<string, EllipsoidInstance[]>();
    const aniso = this.structure?.thermalAniso;
    if (this.showEllipsoids && aniso && !style.startsWith('wire') && style !== 'stick') {
      for (let i = 0; i < species.length; i++) {
        const unitIdx = this.expandedUnitCellIndex[i] ?? i;
        const u = aniso[unitIdx];
        if (!u) continue;
        if (this.elementVisibility.get(species[i]) === false) continue;
        ellipsoidIdxSet.add(i);
        const list = ellipsoidGroups.get(species[i]) ?? [];
        if (list.length === 0) ellipsoidGroups.set(species[i], list);
        list.push({ position: positions[i], uij: u });
      }
      if (ellipsoidGroups.size > 0) {
        this.ellipsoidRenderer.rebuild(ellipsoidGroups, (el) => this.getElementColor(el));
      }
    }

    // 16.2 partial occupancy routing: pick out atoms with occupancy < 1.0
    // (skipping those already routed to ellipsoid). Rendered later as
    // individual transparent Phong meshes — preserves per-site opacity at
    // the cost of one Mesh per partial atom (typically a small handful).
    const partialIdxSet = new Set<number>();
    const occupancy = this.structure?.occupancy;
    if (this.showPartialOccupancy && occupancy && !style.startsWith('wire')) {
      for (let i = 0; i < species.length; i++) {
        if (ellipsoidIdxSet.has(i)) continue;
        const unitIdx = this.expandedUnitCellIndex[i] ?? i;
        const occ = occupancy[unitIdx];
        if (occ === undefined || occ >= 1.0 - 1e-6) continue;
        if (this.elementVisibility.get(species[i]) === false) continue;
        partialIdxSet.add(i);
      }
    }

    const groups = new Map<string, number[]>();
    for (let i = 0; i < species.length; i++) {
      if (ellipsoidIdxSet.has(i)) continue;
      if (partialIdxSet.has(i)) continue;
      const s = species[i];
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(i);
    }

    const isWireframe = style === 'wireframe';
    // Impostor only for solid-shaded styles — wireframe keeps the real sphere.
    const useImpostor = !isWireframe && this.impostorEnabled;

    let sphereGeo: THREE.BufferGeometry | null = null;
    let impostorMat: THREE.ShaderMaterial | null = null;
    if (useImpostor) {
      impostorMat = createImpostorMaterial();
      impostorMat.uniforms.uOrtho.value = (this.cameraMode === 'orthographic');
      this.trackMat(impostorMat);
      this.currentImpostorMaterial = impostorMat;
    } else {
      const [ws, hs] = this.getSphereSegments(species.length);
      sphereGeo = new THREE.SphereGeometry(1, ws, hs);
      this.geometries.push(sphereGeo);
      this.currentImpostorMaterial = null;
    }

    // Chunking: partition each element's instances into spatial bins so
    // Three.js frustum culls off-screen chunks. Only worthwhile for big scenes.
    const CHUNK_THRESHOLD = 5000;
    const useChunks = species.length >= CHUNK_THRESHOLD;
    const binAxis = species.length >= 20000 ? 3 : 2;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (useChunks) {
      for (const p of positions) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
      }
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const spanZ = Math.max(maxZ - minZ, 1e-6);

    const emit = (indicesSubset: number[], element: string) => {
      const elData = getElement(element);
      const color = this.getElementColor(element);
      const customRadius = this.elementRadiusOverrides.get(element);
      let mesh: THREE.InstancedMesh;
      if (useImpostor) {
        mesh = new SphereImpostorMesh(indicesSubset.length, impostorMat!);
      } else {
        const mat = isWireframe
          ? this.getWireframeMaterial(color)
          : this.getMaterial(color, 80);
        mesh = new THREE.InstancedMesh(sphereGeo!, mat, indicesSubset.length);
      }
      const dummy = new THREE.Object3D();
      for (let i = 0; i < indicesSubset.length; i++) {
        const idx = indicesSubset[i];
        const pos = positions[idx];
        dummy.position.set(pos[0], pos[1], pos[2]);
        let r: number;
        switch (style) {
          case 'space-filling': r = customRadius != null ? customRadius * 3 : elData.vdwRadius; break;
          case 'stick': r = customRadius ?? 0.15; break;
          default: r = customRadius ?? elData.displayRadius; break;
        }
        dummy.scale.set(r, r, r);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      const baseCol = new THREE.Color(color);
      for (let i = 0; i < indicesSubset.length; i++) mesh.setColorAt(i, baseCol);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (useChunks && !useImpostor) {
        // InstancedMesh.computeBoundingSphere unions all instance positions.
        // Impostor path sets frustumCulled=false (billboard quad isn't a real hit surface).
        mesh.computeBoundingSphere();
      }
      this.atomGroup.add(mesh);
      this.atomMeshMap.push({ mesh, globalIndices: indicesSubset, baseColor: baseCol });
    };

    for (const [element, indices] of groups) {
      if (this.elementVisibility.get(element) === false) continue;

      if (!useChunks) {
        emit(indices, element);
        continue;
      }

      const bins = new Map<string, number[]>();
      for (const idx of indices) {
        const p = positions[idx];
        const bx = Math.min(binAxis - 1, Math.max(0, Math.floor((p[0] - minX) / spanX * binAxis)));
        const by = Math.min(binAxis - 1, Math.max(0, Math.floor((p[1] - minY) / spanY * binAxis)));
        const bz = Math.min(binAxis - 1, Math.max(0, Math.floor((p[2] - minZ) / spanZ * binAxis)));
        const key = `${bx},${by},${bz}`;
        let bucket = bins.get(key);
        if (!bucket) { bucket = []; bins.set(key, bucket); }
        bucket.push(idx);
      }
      for (const [, binIndices] of bins) emit(binIndices, element);
    }

    // 16.2 partial-occupancy render block — runs after the regular per-element
    // emit. Each partial site gets its own Mesh (not InstancedMesh) so we can
    // set the material's `opacity = occupancy[i]` per atom. Materials are
    // cached within this rebuild by (element, opacity) to avoid leaking
    // GPU resources for repeated values (typical CIFs have ≤ 3 distinct
    // occupancy values per element). Materials are tracked for disposal in
    // disposeResources.
    if (partialIdxSet.size > 0 && occupancy) {
      const partialSphereGeo = new THREE.SphereGeometry(1, 24, 16);
      this.geometries.push(partialSphereGeo);
      const matCache = new Map<string, THREE.MeshPhongMaterial>();
      const dummy = new THREE.Object3D();
      for (const i of partialIdxSet) {
        const element = species[i];
        const elData = getElement(element);
        const color = this.getElementColor(element);
        const customRadius = this.elementRadiusOverrides.get(element);
        const unitIdx = this.expandedUnitCellIndex[i] ?? i;
        const occ = occupancy[unitIdx];
        let r: number;
        switch (style) {
          case 'space-filling': r = customRadius != null ? customRadius * 3 : elData.vdwRadius; break;
          case 'stick': r = customRadius ?? 0.15; break;
          default: r = customRadius ?? elData.displayRadius; break;
        }
        const matKey = `${color}_${occ.toFixed(3)}`;
        let mat = matCache.get(matKey);
        if (!mat) {
          mat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(color),
            shininess: 80,
            transparent: true,
            opacity: occ,
            // Disable depth write so stacked partial atoms (Mg+Fe at the same
            // site) blend without one occluding the other. Slight artifact:
            // ordering with non-partial atoms isn't strictly back-to-front.
            depthWrite: false,
          });
          this.materials.push(mat);
          matCache.set(matKey, mat);
        }
        const mesh = new THREE.Mesh(partialSphereGeo, mat);
        dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
        dummy.scale.set(r, r, r);
        dummy.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(dummy.matrix);
        // Render after opaque atoms to get correct alpha blending.
        mesh.renderOrder = 1;
        this.atomGroup.add(mesh);
      }
    }
  }

  // --- Polyhedra ---

  getPolyhedraCenters(): string[] {
    return [...this.polyhedraCenters];
  }

  setPolyhedraCenters(elements: string[]) {
    this.polyhedraCenters = new Set(elements);
    this.polyhedraCentersUserSet = true;
    if (this.showPolyhedra) {
      this.buildPolyhedra();
      this.requestRender();
    }
  }

  /**
   * Auto-select polyhedra centers using first-coordination-shell analysis:
   *   For each atom, take only neighbors within 1.2× the nearest-neighbor
   *   distance (the "first shell"). Aggregate first-shell ligands across
   *   all atoms of element E. Keep E if:
   *     • max first-shell coord ∈ [4, 8]
   *     • the aggregated dominant ligand element ≠ E AND makes up ≥ 0.85
   *
   * First-shell cutoff avoids over-aggressive cation-cation "bonds" that
   * default bond detection emits at typical ionic distances (e.g. Sr-Ti
   * at 3.38 Å in perovskite). It also captures mixed-ligand anions as
   * bridging: O in ABO3 has 2 B neighbors at 1.95 Å but Sr at 2.76 Å is
   * outside 1.2×1.95 = 2.34 → first-shell coord = 2 → excluded by [4,8].
   */
  private autoDetectPolyhedraCenters() {
    this.polyhedraCenters.clear();
    if (this.cachedBonds.length === 0) return;

    const neighbors = new Map<number, { idx: number; dist: number }[]>();
    for (const bond of this.cachedBonds) {
      if (!neighbors.has(bond.i)) neighbors.set(bond.i, []);
      if (!neighbors.has(bond.j)) neighbors.set(bond.j, []);
      neighbors.get(bond.i)!.push({ idx: bond.j, dist: bond.distance });
      neighbors.get(bond.j)!.push({ idx: bond.i, dist: bond.distance });
    }

    const atomsByElement = new Map<string, number[]>();
    for (const atomIdx of neighbors.keys()) {
      const el = this.expandedSpecies[atomIdx];
      if (!atomsByElement.has(el)) atomsByElement.set(el, []);
      atomsByElement.get(el)!.push(atomIdx);
    }

    const FIRST_SHELL_TOL = 1.2;

    for (const [el, atomIdxs] of atomsByElement) {
      let maxCoord = 0;
      const ligandTotals = new Map<string, number>();
      let totalNbrs = 0;

      for (const atomIdx of atomIdxs) {
        const nbrs = neighbors.get(atomIdx)!;
        if (nbrs.length === 0) continue;
        // Nearest heteroatomic neighbor — skips boundary atoms that only
        // see same-element periodic images, which would otherwise dilute
        // the ligand tally.
        let minDist = Infinity;
        for (const n of nbrs) {
          if (this.expandedSpecies[n.idx] !== el && n.dist < minDist) minDist = n.dist;
        }
        if (!isFinite(minDist)) continue;
        const shellCut = minDist * FIRST_SHELL_TOL;

        let shellCount = 0;
        for (const n of nbrs) {
          if (n.dist > shellCut) continue;
          const nEl = this.expandedSpecies[n.idx];
          ligandTotals.set(nEl, (ligandTotals.get(nEl) ?? 0) + 1);
          totalNbrs++;
          shellCount++;
        }
        if (shellCount > maxCoord) maxCoord = shellCount;
      }

      if (maxCoord < 4 || maxCoord > 8) continue;
      if (totalNbrs === 0) continue;

      let dominantEl = '';
      let dominantCount = 0;
      for (const [nEl, count] of ligandTotals) {
        if (count > dominantCount) { dominantCount = count; dominantEl = nEl; }
      }
      if (dominantEl === el) continue;
      if (dominantCount / totalNbrs >= 0.85) this.polyhedraCenters.add(el);
    }
  }

  private buildPolyhedra() {
    this.clearGroup(this.polyhedraGroup);
    if (this.cachedBonds.length === 0) return;
    if (this.polyhedraCenters.size === 0) return;

    const neighbors = new Map<number, { idx: number; dist: number }[]>();
    for (const bond of this.cachedBonds) {
      if (!neighbors.has(bond.i)) neighbors.set(bond.i, []);
      if (!neighbors.has(bond.j)) neighbors.set(bond.j, []);
      neighbors.get(bond.i)!.push({ idx: bond.j, dist: bond.distance });
      neighbors.get(bond.j)!.push({ idx: bond.i, dist: bond.distance });
    }

    const FIRST_SHELL_TOL = 1.2;

    for (const [center, nbrs] of neighbors) {
      const element = this.expandedSpecies[center];
      if (!this.polyhedraCenters.has(element)) continue;
      if (nbrs.length === 0) continue;

      // Use nearest heteroatomic neighbor so boundary atoms don't draw
      // phantom "polyhedra" from their same-element periodic images.
      let minDist = Infinity;
      for (const n of nbrs) {
        if (this.expandedSpecies[n.idx] !== element && n.dist < minDist) minDist = n.dist;
      }
      if (!isFinite(minDist)) continue;
      const shellCut = minDist * FIRST_SHELL_TOL;

      const shell = nbrs.filter(n => n.dist <= shellCut && this.expandedSpecies[n.idx] !== element);
      if (shell.length < 4) continue;

      const nbrPositions = shell.map(n => new THREE.Vector3(...this.expandedPositions[n.idx]));
      this.addPolyhedron(nbrPositions, element);
    }
  }

  private addPolyhedron(vertices: THREE.Vector3[], element: string) {
    if (vertices.length < 4) return;

    let geo: ConvexGeometry;
    try {
      geo = new ConvexGeometry(vertices);
    } catch {
      // ConvexHull throws on degenerate (all-coplanar) point sets; skip
      return;
    }

    const posAttr = geo.getAttribute('position');
    if (!posAttr || posAttr.count < 3) {
      geo.dispose();
      return;
    }

    this.geometries.push(geo);

    const color = new THREE.Color(this.getElementColor(element));
    const mat = this.trackMat(new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      shininess: 30,
    }));
    this.polyhedraGroup.add(new THREE.Mesh(geo, mat));

    const edgesGeo = new THREE.EdgesGeometry(geo);
    this.geometries.push(edgesGeo);
    const edgesMat = this.trackMat(new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.6) }));
    this.polyhedraGroup.add(new THREE.LineSegments(edgesGeo, edgesMat));
  }

  // --- Labels (sprites) ---

  private buildLabels() {
    this.clearGroup(this.labelGroup);
    for (let i = 0; i < this.expandedSpecies.length; i++) {
      const tex = this.getLabelTexture(this.expandedSpecies[i]);
      const mat = this.trackMat(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false }));
      const sprite = new THREE.Sprite(mat);
      const p = this.expandedPositions[i];
      sprite.position.set(p[0], p[1] + 0.5, p[2]);
      sprite.scale.set(0.8, 0.4, 1);
      this.labelGroup.add(sprite);
    }
  }

  private getLabelTexture(element: string): THREE.Texture {
    let tex = this.labelTextureCache.get(element);
    if (tex) return tex;

    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(0, 0, 128, 64, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(element, 64, 32);

    tex = new THREE.CanvasTexture(c);
    this.labelTextureCache.set(element, tex);
    this.textures.push(tex);
    return tex;
  }

  // --- Unit cell ---

  private buildUnitCell(lattice: [number, number, number][]) {
    const [a, b, c] = lattice;
    const [na, nb, nc] = this.supercell;

    // Helper: compute corner at ia*a + ib*b + ic*c
    const corner = (ia: number, ib: number, ic: number): [number, number, number] => [
      ia * a[0] + ib * b[0] + ic * c[0],
      ia * a[1] + ib * b[1] + ic * c[1],
      ia * a[2] + ib * b[2] + ic * c[2],
    ];

    // Supercell outer boundary (solid lines)
    const sa = corner(na, 0, 0), sb = corner(0, nb, 0), sc = corner(0, 0, nc);
    const o = [0, 0, 0];
    const outerCorners = [
      o, sa, sb, sc,
      corner(na, nb, 0), corner(na, 0, nc), corner(0, nb, nc), corner(na, nb, nc),
    ];
    const outerEdges = [
      [0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4], [2, 6],
      [3, 5], [3, 6], [4, 7], [5, 7], [6, 7],
    ];
    const outerPts: number[] = [];
    for (const [i, j] of outerEdges) {
      outerPts.push(outerCorners[i][0], outerCorners[i][1], outerCorners[i][2]);
      outerPts.push(outerCorners[j][0], outerCorners[j][1], outerCorners[j][2]);
    }
    const outerGeo = new THREE.BufferGeometry();
    outerGeo.setAttribute('position', new THREE.Float32BufferAttribute(outerPts, 3));
    this.geometries.push(outerGeo);
    this.cellGroup.add(new THREE.LineSegments(outerGeo, this.trackMat(new THREE.LineBasicMaterial({ color: this.paletteColors().line }))));

    // Unit cell boundaries as dashed lines (rendered on top of atoms)
    // For 1x1x1: the outer boundary itself; for supercell: internal slices
    {
      const dashPts: THREE.Vector3[] = [];

      // 1x1x1: draw unit cell edges as dashed overlay
      if (na === 1 && nb === 1 && nc === 1) {
        for (const [i, j] of outerEdges) {
          dashPts.push(
            new THREE.Vector3(outerCorners[i][0], outerCorners[i][1], outerCorners[i][2]),
            new THREE.Vector3(outerCorners[j][0], outerCorners[j][1], outerCorners[j][2]),
          );
        }
      }

      // Internal slices perpendicular to a
      for (let ia = 1; ia < na; ia++) {
        const c00 = corner(ia, 0, 0), c01 = corner(ia, 0, nc);
        const c10 = corner(ia, nb, 0), c11 = corner(ia, nb, nc);
        dashPts.push(new THREE.Vector3(...c00), new THREE.Vector3(...c10));
        dashPts.push(new THREE.Vector3(...c00), new THREE.Vector3(...c01));
        dashPts.push(new THREE.Vector3(...c10), new THREE.Vector3(...c11));
        dashPts.push(new THREE.Vector3(...c01), new THREE.Vector3(...c11));
      }
      // Internal slices perpendicular to b
      for (let ib = 1; ib < nb; ib++) {
        const c00 = corner(0, ib, 0), c01 = corner(0, ib, nc);
        const c10 = corner(na, ib, 0), c11 = corner(na, ib, nc);
        dashPts.push(new THREE.Vector3(...c00), new THREE.Vector3(...c10));
        dashPts.push(new THREE.Vector3(...c00), new THREE.Vector3(...c01));
        dashPts.push(new THREE.Vector3(...c10), new THREE.Vector3(...c11));
        dashPts.push(new THREE.Vector3(...c01), new THREE.Vector3(...c11));
      }
      // Internal slices perpendicular to c
      for (let ic = 1; ic < nc; ic++) {
        const c00 = corner(0, 0, ic), c01 = corner(0, nb, ic);
        const c10 = corner(na, 0, ic), c11 = corner(na, nb, ic);
        dashPts.push(new THREE.Vector3(...c00), new THREE.Vector3(...c10));
        dashPts.push(new THREE.Vector3(...c00), new THREE.Vector3(...c01));
        dashPts.push(new THREE.Vector3(...c10), new THREE.Vector3(...c11));
        dashPts.push(new THREE.Vector3(...c01), new THREE.Vector3(...c11));
      }

      if (dashPts.length > 0) {
        const dashGeo = new THREE.BufferGeometry().setFromPoints(dashPts);
        this.geometries.push(dashGeo);
        const dashMat = this.trackMat(new THREE.LineDashedMaterial({
          color: this.paletteColors().dash,
          dashSize: 0.3,
          gapSize: 0.15,
          depthTest: false,
        }));
        const dashLines = new THREE.LineSegments(dashGeo, dashMat);
        dashLines.computeLineDistances();
        dashLines.renderOrder = 998;
        this.cellGroup.add(dashLines);
      }
    }
  }

  // --- Camera ---

  private fitCamera() {
    const box = new THREE.Box3();
    box.setFromObject(this.atomGroup);
    if (box.isEmpty()) box.setFromObject(this.cellGroup);
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim / (2 * Math.tan((this.perspCamera.fov * Math.PI) / 360)) * 2.0;

    // Compute view direction and up from lattice (c-axis up, view from a*)
    let viewDir = new THREE.Vector3(0, 0, 1); // fallback
    let up = new THREE.Vector3(0, 1, 0);      // fallback

    if (this.structure) {
      const lat = this.structure.lattice;
      const a = new THREE.Vector3(...lat[0]);
      const b = new THREE.Vector3(...lat[1]);
      const c = new THREE.Vector3(...lat[2]);
      up = c.clone().normalize();
      viewDir = b.clone().cross(c).normalize(); // a* direction
    }

    this.perspCamera.up.copy(up);
    this.orthoCamera.up.copy(up);

    const camPos = center.clone().add(viewDir.multiplyScalar(dist));
    this.perspCamera.position.copy(camPos);
    this.perspCamera.lookAt(center);

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const frustum = maxDim * 2.0;
    this.orthoCamera.left = -frustum * aspect / 2;
    this.orthoCamera.right = frustum * aspect / 2;
    this.orthoCamera.top = frustum / 2;
    this.orthoCamera.bottom = -frustum / 2;
    this.orthoCamera.zoom = 1;
    this.orthoCamera.updateProjectionMatrix();
    this.orthoCamera.position.copy(camPos);
    this.orthoCamera.lookAt(center);

    // Dynamically adjust clipping planes and fog for large structures
    const farPlane = Math.max(500, dist * 4);
    this.perspCamera.far = farPlane;
    this.perspCamera.updateProjectionMatrix();
    this.orthoCamera.far = farPlane;
    this.orthoCamera.updateProjectionMatrix();

    if (this.scene.fog instanceof THREE.FogExp2) {
      // Scale fog density inversely with scene size so distant atoms remain visible
      this.scene.fog.density = Math.min(0.015, 3.0 / farPlane);
    }

    this.controls.target.copy(center);
    this.controls.update();
  }

  // --- Resource disposal ---

  private disposeResources() {
    this.clearGroup(this.atomGroup);
    this.bondRenderer.dispose();
    this.clearGroup(this.cellGroup);
    this.clearGroup(this.labelGroup);
    this.clearGroup(this.polyhedraGroup);
    this.clearGroup(this.measureGroup);
    this.clearGroup(this.planeGroup);
    this.clearGroup(this.isoGroup);
    this.atomMeshMap = [];
    this.measurements = [];

    for (const geo of this.geometries) geo.dispose();
    this.geometries = [];
    for (const tex of this.textures) tex.dispose();
    this.textures = [];

    this.disposeAllMaterials();
    this.labelTextureCache.clear();
  }

  private clearGroup(group: THREE.Group) {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  }

  private onResize() {
    // Read the canvas' own rendered size so layout modes (overlay/offset)
    // that shrink the canvas below the viewport width work correctly.
    const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 0;
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 0;
    if (!w || !h) return;
    const aspect = w / h;

    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    const frustumH = (this.orthoCamera.top - this.orthoCamera.bottom);
    this.orthoCamera.left = -frustumH * aspect / 2;
    this.orthoCamera.right = frustumH * aspect / 2;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    this.requestRender();
  }
}
