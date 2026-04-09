import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CrystalStructure } from '../parsers/types';
import { getWebElement, getElementPaletteColor, getPaletteLineColors } from './elements-data';
import type { ColorPalette } from './elements-data';
import type { DisplayStyle, CameraMode, BondStyle } from './message';
import { marchingCubes } from './marchingCubes';
import type { VolumetricData } from '../parsers/types';

interface BondInfo {
  i: number;
  j: number;
  distance: number;
}

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
  private bondGroup = new THREE.Group();
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

  // Per-element user overrides
  private elementColorOverrides = new Map<string, string>();
  private elementRadiusOverrides = new Map<string, number>();
  private elementVisibility = new Map<string, boolean>();
  private colorPalette: ColorPalette = 'dark';

  // On-demand rendering
  private renderRequested = false;

  // Material cache
  private materialCache = new Map<string, THREE.MeshPhongMaterial>();

  // Resource tracking
  private geometries: THREE.BufferGeometry[] = [];
  private textures: THREE.Texture[] = [];

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
  private axisScene = new THREE.Scene();
  private axisCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  private axisArrows: THREE.Group = new THREE.Group();
  private axisInsetSize = 300;

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
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    const bgColor = this.getBackgroundColor();
    this.scene.fog = new THREE.FogExp2(bgColor, 0.015);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 7);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-5, -5, -5);
    this.scene.add(ambient, dir1, dir2);

    this.scene.add(this.atomGroup, this.bondGroup, this.cellGroup, this.labelGroup, this.polyhedraGroup, this.measureGroup, this.planeGroup, this.isoGroup);
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
    ro.observe(canvas.parentElement || canvas);

    // Click handler for picking
    canvas.addEventListener('click', (e) => this.onCanvasClick(e));

    // Quaternion-based free rotation (no gimbal lock) + constrained rotation
    this.initFreeRotation(canvas);

    this.requestRender();
  }

  // --- Public API ---

  loadStructure(structure: CrystalStructure) {
    this.structure = structure;
    this.bondParams.clear();
    this.selectedAtoms = [];
    this.clearMeasurements();
    this.updateAxisIndicator();
    this.rebuild();
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
    if (this.showBonds && this.bondGroup.children.length === 0 && this.cachedBonds.length > 0) {
      this.buildVisuals();
      return;
    }
    this.bondGroup.visible = this.showBonds && this.displayStyle !== 'space-filling';
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
    this.requestRender();
  }

  getCameraMode(): CameraMode { return this.cameraMode; }

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
    this.axisInsetSize = Math.max(60, Math.min(400, size));
    this.requestRender();
  }

  getAxisIndicatorSize(): number { return this.axisInsetSize; }

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
    return this.elementRadiusOverrides.get(element) || getWebElement(element).displayRadius;
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
      this.rebuild(false);
    }
    if (this.volumetricData) this.buildIsosurface();
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

    const planeMat = new THREE.MeshPhongMaterial({
      color: colors[colorIdx],
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

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

    const vd = this.volumetricData;

    // Positive isosurface
    if (this.isoLevel > 0) {
      const result = marchingCubes(vd.data, vd.dims, vd.origin, vd.lattice, this.isoLevel);
      if (result.positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
        this.geometries.push(geo);
        const mat = new THREE.MeshPhongMaterial({
          color: this.paletteColors().isoPos,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
        });
        this.isoGroup.add(new THREE.Mesh(geo, mat));
      }
    }

    // Negative isosurface
    if (this.isoLevel > 0) {
      const result = marchingCubes(vd.data, vd.dims, vd.origin, vd.lattice, -this.isoLevel);
      if (result.positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
        this.geometries.push(geo);
        const mat = new THREE.MeshPhongMaterial({
          color: this.paletteColors().isoNeg,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
        });
        this.isoGroup.add(new THREE.Mesh(geo, mat));
      }
    }

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
    displayStyle: DisplayStyle;
    cameraMode: CameraMode;
    showBonds: boolean;
    showLabels: boolean;
    supercell: [number, number, number];
    cameraPosition: [number, number, number];
    controlsTarget: [number, number, number];
    orthoZoom: number;
    colorPalette: ColorPalette;
  } {
    const pos = this.activeCamera.position;
    const target = this.controls.target;
    return {
      displayStyle: this.displayStyle,
      cameraMode: this.cameraMode,
      showBonds: this.showBonds,
      showLabels: this.showLabels,
      supercell: this.supercell,
      cameraPosition: [pos.x, pos.y, pos.z],
      controlsTarget: [target.x, target.y, target.z],
      orthoZoom: this.orthoCamera.zoom,
      colorPalette: this.colorPalette,
    };
  }

  restoreState(state: ReturnType<CrystalRenderer['getState']>) {
    this.displayStyle = state.displayStyle;
    this.showBonds = state.showBonds;
    this.showLabels = state.showLabels;
    this.supercell = state.supercell;
    if (state.colorPalette) this.colorPalette = state.colorPalette;

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

  private initAxisIndicator() {
    this.axisCamera.position.set(0, 0, 5);
    this.axisCamera.lookAt(0, 0, 0);
    const light = new THREE.AmbientLight(0xffffff, 1.0);
    this.axisScene.add(light);
    this.axisScene.add(this.axisArrows);

    // Build default axes (will be updated when structure loads)
    this.buildAxisArrows(
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    );
  }

  private buildAxisArrows(a: number[], b: number[], c: number[]) {
    // Clear existing
    while (this.axisArrows.children.length > 0) {
      this.axisArrows.remove(this.axisArrows.children[0]);
    }

    const dirs = [
      { v: new THREE.Vector3(...a).normalize(), color: 0xff3333, label: 'a' },
      { v: new THREE.Vector3(...b).normalize(), color: 0x33cc33, label: 'b' },
      { v: new THREE.Vector3(...c).normalize(), color: 0x3377ff, label: 'c' },
    ];

    for (const { v, color, label } of dirs) {
      // Arrow shaft (cylinder)
      const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8);
      shaftGeo.translate(0, 0.5, 0);
      shaftGeo.rotateX(Math.PI / 2);
      const shaftMat = new THREE.MeshBasicMaterial({ color });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.lookAt(v);
      this.axisArrows.add(shaft);

      // Arrow head (cone)
      const headGeo = new THREE.ConeGeometry(0.1, 0.25, 8);
      headGeo.translate(0, 0.125, 0);
      headGeo.rotateX(Math.PI / 2);
      const headMat = new THREE.MeshBasicMaterial({ color });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.copy(v.clone().multiplyScalar(1.0));
      head.lookAt(v.clone().multiplyScalar(2));
      this.axisArrows.add(head);

      // Label
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(v.clone().multiplyScalar(1.4));
      sprite.scale.set(0.4, 0.4, 1);
      this.axisArrows.add(sprite);
    }

    // Origin sphere
    const originGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const originMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
    this.axisArrows.add(new THREE.Mesh(originGeo, originMat));
  }

  /** Update axis directions when a structure is loaded */
  private updateAxisIndicator() {
    if (!this.structure) return;
    const lat = this.structure.lattice;
    this.buildAxisArrows(lat[0], lat[1], lat[2]);
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

    // Main scene (full viewport)
    this.renderer.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.activeCamera);

    // Axis indicator (bottom-left inset) — overlay without clearing color buffer
    const insetSize = this.axisInsetSize;
    const insetX = 4;
    const insetY = 4;

    // Sync axis camera orientation with main camera
    const camDir = this.activeCamera.position.clone().sub(this.controls.target).normalize();
    this.axisCamera.position.copy(camDir.multiplyScalar(5));
    this.axisCamera.up.copy(this.activeCamera.up);
    this.axisCamera.lookAt(0, 0, 0);

    this.renderer.setViewport(insetX, insetY, insetSize, insetSize);
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(insetX, insetY, insetSize, insetSize);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.axisScene, this.axisCamera);
    this.renderer.autoClear = true;
    this.renderer.setScissorTest(false);
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

    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(mouse, this.activeCamera);

    // Intersect all atom meshes
    let closestAtomIdx = -1;
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
    const lineMat = new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: 0.2, gapSize: 0.1 });
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
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.4, 1);
    return sprite;
  }

  // --- Rebuild ---

  private rebuild(resetCamera = true) {
    const struct = this.structure!;
    this.disposeResources();

    const { species, positions } = this.expandSupercell(struct);
    this.expandedSpecies = species;
    this.expandedPositions = positions;

    // Auto-populate bond params for new species pairs
    this.autoPopulateBondParams(species);

    // Detect bonds (cached for style switching)
    this.cachedBonds = this.detectBonds(species, positions);

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
          const max = getWebElement(sorted[i]).covalentRadius + getWebElement(sorted[j]).covalentRadius + 0.3;
          this.bondParams.set(pair, { min: 0.1, max, enabled: true });
        }
      }
    }
  }

  private buildVisuals() {
    this.clearGroup(this.atomGroup);
    this.clearGroup(this.bondGroup);
    this.clearGroup(this.labelGroup);
    this.clearGroup(this.polyhedraGroup);
    this.atomMeshMap = [];

    const species = this.expandedSpecies;
    const positions = this.expandedPositions;
    const bonds = this.cachedBonds;
    const style = this.displayStyle;

    this.buildAtoms(species, positions, style, bonds);

    if (style !== 'space-filling' && this.showBonds) {
      if (style === 'wireframe') {
        this.buildBondsWireframe(species, positions, bonds);
      } else if (this.bondStyle === 'line') {
        this.buildBondsWireframe(species, positions, bonds);
      } else {
        const bondRadius = style === 'stick' ? 0.15 : 0.08;
        this.buildBondsCylinder(species, positions, bonds, bondRadius);
      }
    }
    this.bondGroup.visible = this.showBonds && style !== 'space-filling';

    if (this.showLabels) this.buildLabels();
    this.labelGroup.visible = this.showLabels;

    if (this.showPolyhedra) this.buildPolyhedra();
    this.polyhedraGroup.visible = this.showPolyhedra;

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

  private detectBonds(species: string[], positions: [number, number, number][]): BondInfo[] {
    const n = positions.length;
    if (n > 5000) return [];

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
    const groups = new Map<string, number[]>();
    for (let i = 0; i < species.length; i++) {
      const s = species[i];
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(i);
    }

    const [ws, hs] = this.getSphereSegments(species.length);
    const sphereGeo = new THREE.SphereGeometry(1, ws, hs);
    this.geometries.push(sphereGeo);
    const dummy = new THREE.Object3D();

    for (const [element, indices] of groups) {
      if (this.elementVisibility.get(element) === false) continue;

      const elData = getWebElement(element);
      const color = this.getElementColor(element);
      const customRadius = this.elementRadiusOverrides.get(element);
      const isWireframe = style === 'wireframe';
      const mat = isWireframe
        ? this.getWireframeMaterial(color)
        : this.getMaterial(color, 80);

      const mesh = new THREE.InstancedMesh(sphereGeo, mat, indices.length);

      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
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

      // Initialize instance colors for selection highlight support
      const baseCol = new THREE.Color(color);
      for (let i = 0; i < indices.length; i++) {
        mesh.setColorAt(i, baseCol);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      mesh.instanceMatrix.needsUpdate = true;
      this.atomGroup.add(mesh);
      this.atomMeshMap.push({ mesh, globalIndices: indices, baseColor: baseCol });
    }
  }

  // --- Bond building (cylinder) ---

  private buildBondsCylinder(species: string[], positions: [number, number, number][], bonds: BondInfo[], radius: number) {
    if (this.bondStyle === 'unicolor') {
      this.buildBondsCylinderUnicolor(species, positions, bonds, radius);
      return;
    }

    const bondHalves = new Map<string, { position: THREE.Vector3; target: THREE.Vector3; length: number }[]>();

    for (const bond of bonds) {
      const from = new THREE.Vector3(...positions[bond.i]);
      const to = new THREE.Vector3(...positions[bond.j]);
      const mid = from.clone().lerp(to, 0.5);
      const halfLen = bond.distance / 2;

      const colorA = this.getElementColor(species[bond.i]);
      const colorB = this.getElementColor(species[bond.j]);

      if (!bondHalves.has(colorA)) bondHalves.set(colorA, []);
      bondHalves.get(colorA)!.push({ position: from, target: mid, length: halfLen });

      if (!bondHalves.has(colorB)) bondHalves.set(colorB, []);
      bondHalves.get(colorB)!.push({ position: mid, target: to, length: halfLen });
    }

    const cylSegments = this.getCylinderSegments(species.length);
    const cylGeo = new THREE.CylinderGeometry(radius, radius, 1, cylSegments);
    cylGeo.translate(0, 0.5, 0);
    cylGeo.rotateX(Math.PI / 2);
    this.geometries.push(cylGeo);

    const dummy = new THREE.Object3D();
    for (const [color, halves] of bondHalves) {
      const mat = this.getMaterial(color, 40);
      const instMesh = new THREE.InstancedMesh(cylGeo, mat, halves.length);
      for (let i = 0; i < halves.length; i++) {
        const h = halves[i];
        dummy.position.copy(h.position);
        dummy.scale.set(1, 1, h.length);
        dummy.lookAt(h.target);
        dummy.updateMatrix();
        instMesh.setMatrixAt(i, dummy.matrix);
      }
      instMesh.instanceMatrix.needsUpdate = true;
      this.bondGroup.add(instMesh);
    }
  }

  private buildBondsCylinderUnicolor(species: string[], positions: [number, number, number][], bonds: BondInfo[], radius: number) {
    const cylSegments = this.getCylinderSegments(species.length);
    const cylGeo = new THREE.CylinderGeometry(radius, radius, 1, cylSegments);
    cylGeo.translate(0, 0.5, 0);
    cylGeo.rotateX(Math.PI / 2);
    this.geometries.push(cylGeo);

    const mat = this.getMaterial(this.paletteColors().bondUnicolor, 40);
    const instMesh = new THREE.InstancedMesh(cylGeo, mat, bonds.length);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < bonds.length; i++) {
      const from = new THREE.Vector3(...positions[bonds[i].i]);
      const to = new THREE.Vector3(...positions[bonds[i].j]);
      dummy.position.copy(from);
      dummy.scale.set(1, 1, bonds[i].distance);
      dummy.lookAt(to);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
    }
    instMesh.instanceMatrix.needsUpdate = true;
    this.bondGroup.add(instMesh);
  }

  // --- Bond building (wireframe lines) ---

  private buildBondsWireframe(species: string[], positions: [number, number, number][], bonds: BondInfo[]) {
    const pts: number[] = [];
    const colors: number[] = [];

    for (const bond of bonds) {
      const from = positions[bond.i];
      const to = positions[bond.j];
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
      const cA = new THREE.Color(this.getElementColor(species[bond.i]));
      const cB = new THREE.Color(this.getElementColor(species[bond.j]));

      pts.push(from[0], from[1], from[2], mid[0], mid[1], mid[2]);
      colors.push(cA.r, cA.g, cA.b, cA.r, cA.g, cA.b);
      pts.push(mid[0], mid[1], mid[2], to[0], to[1], to[2]);
      colors.push(cB.r, cB.g, cB.b, cB.r, cB.g, cB.b);
    }

    if (pts.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.geometries.push(geo);
    this.bondGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
  }

  // --- Polyhedra ---

  private buildPolyhedra() {
    this.clearGroup(this.polyhedraGroup);
    if (this.cachedBonds.length === 0) return;

    // Build adjacency list
    const neighbors = new Map<number, number[]>();
    for (const bond of this.cachedBonds) {
      if (!neighbors.has(bond.i)) neighbors.set(bond.i, []);
      if (!neighbors.has(bond.j)) neighbors.set(bond.j, []);
      neighbors.get(bond.i)!.push(bond.j);
      neighbors.get(bond.j)!.push(bond.i);
    }

    // Find atoms with 4+ neighbors (potential polyhedra centers)
    for (const [center, nbrs] of neighbors) {
      if (nbrs.length < 4) continue;

      const centerPos = new THREE.Vector3(...this.expandedPositions[center]);
      const nbrPositions = nbrs.map(n => new THREE.Vector3(...this.expandedPositions[n]));

      // Simple convex hull via triangle faces
      if (nbrPositions.length >= 4) {
        this.addPolyhedron(centerPos, nbrPositions, this.expandedSpecies[center]);
      }
    }
  }

  private addPolyhedron(center: THREE.Vector3, vertices: THREE.Vector3[], element: string) {
    // Create geometry from vertex positions using convex hull approximation
    // For tetrahedra (4) and octahedra (6) this is straightforward
    const n = vertices.length;
    if (n < 4) return;

    const positions: number[] = [];
    const normals: number[] = [];

    // Generate triangular faces by connecting all triplets of vertices
    // that form outward-facing triangles relative to center
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          const a = vertices[i];
          const b = vertices[j];
          const c = vertices[k];
          const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          const toCenter = center.clone().sub(a).normalize();

          // Face should point away from center
          if (normal.dot(toCenter) > 0) normal.negate();

          // Check if this triangle is a face (no other vertex is on the outside)
          let isFace = true;
          for (let l = 0; l < n; l++) {
            if (l === i || l === j || l === k) continue;
            const d = vertices[l].clone().sub(a).dot(normal);
            if (d > 0.1) { isFace = false; break; }
          }

          if (isFace) {
            if (normal.dot(toCenter) > 0) {
              // Flip winding
              positions.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
            } else {
              positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            }
            const faceNormal = normal.dot(toCenter) > 0 ? normal.clone().negate() : normal;
            normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
            normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
            normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
          }
        }
      }
    }

    if (positions.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    this.geometries.push(geo);

    const color = new THREE.Color(this.getElementColor(element));
    const mat = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      shininess: 30,
    });
    this.polyhedraGroup.add(new THREE.Mesh(geo, mat));

    // Edge outlines
    const edgesGeo = new THREE.EdgesGeometry(geo);
    this.geometries.push(edgesGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.6) });
    this.polyhedraGroup.add(new THREE.LineSegments(edgesGeo, edgesMat));
  }

  // --- Labels (sprites) ---

  private buildLabels() {
    this.clearGroup(this.labelGroup);
    for (let i = 0; i < this.expandedSpecies.length; i++) {
      const tex = this.getLabelTexture(this.expandedSpecies[i]);
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
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
    this.cellGroup.add(new THREE.LineSegments(outerGeo, new THREE.LineBasicMaterial({ color: this.paletteColors().line })));

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
        const dashMat = new THREE.LineDashedMaterial({
          color: this.paletteColors().dash,
          dashSize: 0.3,
          gapSize: 0.15,
          depthTest: false,
        });
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
    this.clearGroup(this.bondGroup);
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
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    const aspect = w / h;

    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    const frustumH = (this.orthoCamera.top - this.orthoCamera.bottom);
    this.orthoCamera.left = -frustumH * aspect / 2;
    this.orthoCamera.right = frustumH * aspect / 2;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
    this.requestRender();
  }
}
