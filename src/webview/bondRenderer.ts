import * as THREE from 'three';
import type { BondStyle, DisplayStyle } from './message';
import { CylinderImpostorMesh, createCylinderImpostorMaterial } from './cylinderImpostor';

export interface BondInfo {
  i: number;
  j: number;
  distance: number;
}

interface BondRendererDeps {
  /** Resolve an element symbol to its current hex color (palette/overrides applied). */
  getElementColor: (element: string) => string;
  /** Get a cached Phong material for a color — the renderer owns the cache. */
  getPhongMaterial: (color: string, shininess: number) => THREE.Material;
  /** Adaptive cylinder tessellation based on total atom count. */
  getCylinderSegments: (atomCount: number) => number;
  /** Current unicolor bond color from the palette. */
  getUnicolorColor: () => string;
  /** Whether impostor rendering is enabled for this frame. */
  getImpostorEnabled: () => boolean;
  /** Register a shader material so the renderer can keep its view-space light in sync. */
  registerImpostorMaterial: (mat: THREE.ShaderMaterial | null) => void;
}

/**
 * Owns the bond scene subgraph — cylinders (bicolor + unicolor) and wireframe
 * lines. Geometries and wireframe materials are disposed locally; Phong
 * cylinder materials come from the shared renderer cache.
 */
export class BondRenderer {
  readonly group = new THREE.Group();

  private geometries: THREE.BufferGeometry[] = [];
  /** Materials allocated locally (wireframe lines + impostor shader). Shared Phong materials live in the renderer cache. */
  private localMaterials: THREE.Material[] = [];
  private impostorMeshes: CylinderImpostorMesh[] = [];
  private currentImpostorMaterial: THREE.ShaderMaterial | null = null;

  constructor(private readonly deps: BondRendererDeps) {}

  setVisible(v: boolean) { this.group.visible = v; }

  rebuild(
    species: string[],
    positions: [number, number, number][],
    bonds: BondInfo[],
    bondStyle: BondStyle,
    displayStyle: DisplayStyle,
  ): void {
    this.clear();
    if (bonds.length === 0) return;

    if (displayStyle === 'wireframe' || bondStyle === 'line') {
      this.buildWireframe(species, positions, bonds);
      return;
    }

    const radius = displayStyle === 'stick' ? 0.15 : 0.08;
    if (this.deps.getImpostorEnabled()) {
      this.buildImpostor(species, positions, bonds, radius, bondStyle);
    } else if (bondStyle === 'unicolor') {
      this.buildUnicolor(species, positions, bonds, radius);
    } else {
      this.buildBicolor(species, positions, bonds, radius);
    }
  }

  dispose() { this.clear(); }

  private clear() {
    while (this.group.children.length > 0) this.group.remove(this.group.children[0]);
    for (const g of this.geometries) g.dispose();
    for (const m of this.localMaterials) m.dispose();
    for (const mesh of this.impostorMeshes) mesh.dispose();
    this.geometries = [];
    this.localMaterials = [];
    this.impostorMeshes = [];
    this.currentImpostorMaterial = null;
    this.deps.registerImpostorMaterial(null);
  }

  private buildImpostor(
    species: string[],
    positions: [number, number, number][],
    bonds: BondInfo[],
    radius: number,
    bondStyle: BondStyle,
  ) {
    const mat = createCylinderImpostorMaterial();
    this.localMaterials.push(mat);
    this.currentImpostorMaterial = mat;
    this.deps.registerImpostorMaterial(mat);

    const mesh = new CylinderImpostorMesh(bonds.length, mat);
    const colorA = new THREE.Color();
    const colorB = new THREE.Color();
    const unicolorHex = this.deps.getUnicolorColor();
    if (bondStyle === 'unicolor') {
      colorA.set(unicolorHex);
      colorB.set(unicolorHex);
    }
    for (let k = 0; k < bonds.length; k++) {
      const bond = bonds[k];
      if (bondStyle === 'bicolor') {
        colorA.set(this.deps.getElementColor(species[bond.i]));
        colorB.set(this.deps.getElementColor(species[bond.j]));
      }
      mesh.setInstance(k, positions[bond.i], positions[bond.j], radius, colorA, colorB);
    }
    mesh.commit();
    this.impostorMeshes.push(mesh);
    this.group.add(mesh);
  }

  private buildBicolor(
    species: string[],
    positions: [number, number, number][],
    bonds: BondInfo[],
    radius: number,
  ) {
    const bondHalves = new Map<string, { position: THREE.Vector3; target: THREE.Vector3; length: number }[]>();
    for (const bond of bonds) {
      const from = new THREE.Vector3(...positions[bond.i]);
      const to = new THREE.Vector3(...positions[bond.j]);
      const mid = from.clone().lerp(to, 0.5);
      const halfLen = bond.distance / 2;

      const colorA = this.deps.getElementColor(species[bond.i]);
      const colorB = this.deps.getElementColor(species[bond.j]);

      if (!bondHalves.has(colorA)) bondHalves.set(colorA, []);
      bondHalves.get(colorA)!.push({ position: from, target: mid, length: halfLen });

      if (!bondHalves.has(colorB)) bondHalves.set(colorB, []);
      bondHalves.get(colorB)!.push({ position: mid, target: to, length: halfLen });
    }

    const segs = this.deps.getCylinderSegments(species.length);
    const cylGeo = new THREE.CylinderGeometry(radius, radius, 1, segs);
    cylGeo.translate(0, 0.5, 0);
    cylGeo.rotateX(Math.PI / 2);
    this.geometries.push(cylGeo);

    const dummy = new THREE.Object3D();
    for (const [color, halves] of bondHalves) {
      const mat = this.deps.getPhongMaterial(color, 40);
      const mesh = new THREE.InstancedMesh(cylGeo, mat, halves.length);
      for (let i = 0; i < halves.length; i++) {
        const h = halves[i];
        dummy.position.copy(h.position);
        dummy.scale.set(1, 1, h.length);
        dummy.lookAt(h.target);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  private buildUnicolor(
    species: string[],
    positions: [number, number, number][],
    bonds: BondInfo[],
    radius: number,
  ) {
    const segs = this.deps.getCylinderSegments(species.length);
    const cylGeo = new THREE.CylinderGeometry(radius, radius, 1, segs);
    cylGeo.translate(0, 0.5, 0);
    cylGeo.rotateX(Math.PI / 2);
    this.geometries.push(cylGeo);

    const mat = this.deps.getPhongMaterial(this.deps.getUnicolorColor(), 40);
    const mesh = new THREE.InstancedMesh(cylGeo, mat, bonds.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < bonds.length; i++) {
      const from = new THREE.Vector3(...positions[bonds[i].i]);
      const to = new THREE.Vector3(...positions[bonds[i].j]);
      dummy.position.copy(from);
      dummy.scale.set(1, 1, bonds[i].distance);
      dummy.lookAt(to);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildWireframe(
    species: string[],
    positions: [number, number, number][],
    bonds: BondInfo[],
  ) {
    const pts: number[] = [];
    const colors: number[] = [];
    for (const bond of bonds) {
      const from = positions[bond.i];
      const to = positions[bond.j];
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
      const cA = new THREE.Color(this.deps.getElementColor(species[bond.i]));
      const cB = new THREE.Color(this.deps.getElementColor(species[bond.j]));
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
    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
    this.localMaterials.push(mat);
    this.group.add(new THREE.LineSegments(geo, mat));
  }
}
