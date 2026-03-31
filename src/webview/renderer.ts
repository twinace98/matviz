import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CrystalStructure } from '../parsers/types';
import { getWebElement } from './elements-data';

export class CrystalRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private canvas: HTMLCanvasElement;
  private animationId: number = 0;

  private atomGroup = new THREE.Group();
  private bondGroup = new THREE.Group();
  private cellGroup = new THREE.Group();

  private structure: CrystalStructure | null = null;
  private supercell: [number, number, number] = [1, 1, 1];
  private showBonds = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
    this.camera.position.set(0, 0, 20);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 7);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-5, -5, -5);
    this.scene.add(ambient, dir1, dir2);

    this.scene.add(this.atomGroup, this.bondGroup, this.cellGroup);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    // Resize observer
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas.parentElement || canvas);

    this.animate();
  }

  loadStructure(structure: CrystalStructure) {
    this.structure = structure;
    this.rebuild();
  }

  setSupercell(sc: [number, number, number]) {
    this.supercell = sc;
    if (this.structure) this.rebuild();
  }

  toggleBonds() {
    this.showBonds = !this.showBonds;
    this.bondGroup.visible = this.showBonds;
  }

  resetCamera() {
    if (!this.structure) return;
    this.fitCamera();
  }

  private rebuild() {
    const struct = this.structure!;

    // Clear groups
    this.clearGroup(this.atomGroup);
    this.clearGroup(this.bondGroup);
    this.clearGroup(this.cellGroup);

    // Expand supercell
    const { species, positions } = this.expandSupercell(struct);

    // Build atoms
    this.buildAtoms(species, positions);

    // Build bonds
    if (this.showBonds) {
      this.buildBonds(species, positions);
    }
    this.bondGroup.visible = this.showBonds;

    // Build unit cell wireframe (show full supercell box)
    this.buildUnitCell(struct.lattice);

    // Fit camera
    this.fitCamera();
  }

  private expandSupercell(struct: CrystalStructure): { species: string[]; positions: [number, number, number][] } {
    const [na, nb, nc] = this.supercell;
    const species: string[] = [];
    const positions: [number, number, number][] = [];

    for (let ia = 0; ia < na; ia++) {
      for (let ib = 0; ib < nb; ib++) {
        for (let ic = 0; ic < nc; ic++) {
          const offset: [number, number, number] = [
            ia * struct.lattice[0][0] + ib * struct.lattice[1][0] + ic * struct.lattice[2][0],
            ia * struct.lattice[0][1] + ib * struct.lattice[1][1] + ic * struct.lattice[2][1],
            ia * struct.lattice[0][2] + ib * struct.lattice[1][2] + ic * struct.lattice[2][2],
          ];
          for (let j = 0; j < struct.species.length; j++) {
            species.push(struct.species[j]);
            positions.push([
              struct.positions[j][0] + offset[0],
              struct.positions[j][1] + offset[1],
              struct.positions[j][2] + offset[2],
            ]);
          }
        }
      }
    }

    return { species, positions };
  }

  private buildAtoms(species: string[], positions: [number, number, number][]) {
    // Group atoms by element for InstancedMesh
    const groups = new Map<string, number[]>();
    for (let i = 0; i < species.length; i++) {
      const s = species[i];
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(i);
    }

    const sphereGeo = new THREE.SphereGeometry(1, 24, 16);

    for (const [element, indices] of groups) {
      const elData = getWebElement(element);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(elData.color),
        shininess: 80,
      });

      const mesh = new THREE.InstancedMesh(sphereGeo, mat, indices.length);
      const dummy = new THREE.Object3D();

      for (let i = 0; i < indices.length; i++) {
        const pos = positions[indices[i]];
        dummy.position.set(pos[0], pos[1], pos[2]);
        const r = elData.displayRadius;
        dummy.scale.set(r, r, r);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      this.atomGroup.add(mesh);
    }
  }

  private buildBonds(species: string[], positions: [number, number, number][]) {
    const n = positions.length;
    if (n > 2000) return; // skip bonds for very large structures

    const bondTolerance = 1.2;
    const cylGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 8);
    cylGeo.translate(0, 0.5, 0); // pivot at bottom
    cylGeo.rotateX(Math.PI / 2); // align along Z

    const bonds: { from: [number, number, number]; to: [number, number, number]; colorA: string; colorB: string }[] = [];

    for (let i = 0; i < n; i++) {
      const rA = getWebElement(species[i]).covalentRadius;
      for (let j = i + 1; j < n; j++) {
        const rB = getWebElement(species[j]).covalentRadius;
        const dx = positions[j][0] - positions[i][0];
        const dy = positions[j][1] - positions[i][1];
        const dz = positions[j][2] - positions[i][2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < (rA + rB) * bondTolerance && dist > 0.4) {
          bonds.push({
            from: positions[i],
            to: positions[j],
            colorA: getWebElement(species[i]).color,
            colorB: getWebElement(species[j]).color,
          });
        }
      }
    }

    // Render bonds as split-color cylinders
    for (const bond of bonds) {
      const from = new THREE.Vector3(...bond.from);
      const to = new THREE.Vector3(...bond.to);
      const mid = from.clone().lerp(to, 0.5);
      const dir = to.clone().sub(from);
      const len = dir.length();

      // Half-bond from A to mid
      this.addBondHalf(cylGeo, from, mid, len / 2, bond.colorA);
      // Half-bond from mid to B
      this.addBondHalf(cylGeo, mid, to, len / 2, bond.colorB);
    }
  }

  private addBondHalf(
    geo: THREE.BufferGeometry,
    from: THREE.Vector3,
    to: THREE.Vector3,
    length: number,
    color: string
  ) {
    const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), shininess: 40 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.scale.set(1, 1, length);
    mesh.lookAt(to);
    this.bondGroup.add(mesh);
  }

  private buildUnitCell(lattice: [number, number, number][]) {
    const [a, b, c] = lattice;
    const [na, nb, nc] = this.supercell;

    // Scale lattice vectors by supercell
    const sa: [number, number, number] = [a[0] * na, a[1] * na, a[2] * na];
    const sb: [number, number, number] = [b[0] * nb, b[1] * nb, b[2] * nb];
    const sc: [number, number, number] = [c[0] * nc, c[1] * nc, c[2] * nc];

    const o = [0, 0, 0];
    const corners = [
      o,                                               // 0: origin
      sa,                                              // 1: a
      sb,                                              // 2: b
      sc,                                              // 3: c
      [sa[0] + sb[0], sa[1] + sb[1], sa[2] + sb[2]],  // 4: a+b
      [sa[0] + sc[0], sa[1] + sc[1], sa[2] + sc[2]],  // 5: a+c
      [sb[0] + sc[0], sb[1] + sc[1], sb[2] + sc[2]],  // 6: b+c
      [sa[0] + sb[0] + sc[0], sa[1] + sb[1] + sc[1], sa[2] + sb[2] + sc[2]], // 7: a+b+c
    ];

    const edges = [
      [0, 1], [0, 2], [0, 3],
      [1, 4], [1, 5], [2, 4], [2, 6],
      [3, 5], [3, 6], [4, 7], [5, 7], [6, 7],
    ];

    const pts: number[] = [];
    for (const [i, j] of edges) {
      pts.push(corners[i][0], corners[i][1], corners[i][2]);
      pts.push(corners[j][0], corners[j][1], corners[j][2]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x888888, linewidth: 1 });
    const lines = new THREE.LineSegments(geo, mat);
    this.cellGroup.add(lines);
  }

  private fitCamera() {
    const box = new THREE.Box3();
    box.setFromObject(this.atomGroup);
    if (box.isEmpty()) {
      box.setFromObject(this.cellGroup);
    }
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.5;

    this.camera.position.set(center.x, center.y, center.z + dist);
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  private clearGroup(group: THREE.Group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  private onResize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
