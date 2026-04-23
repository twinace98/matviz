import * as THREE from 'three';
import type { DisplacementPair } from './nnMatching';

/**
 * v0.17.1 (17.3.1) — Displacement arrow renderer for comparison mode.
 *
 * Structurally mirrors magneticArrowRenderer (cone tip + cylinder shaft
 * InstancedMesh, per-instance Quaternion-based orientation, instanceColor).
 * Differences:
 *   - Colormap: Viridis-only (displacement magnitude has no sign convention,
 *     so red-blue diverging would be misleading).
 *   - Default scale: 1.0 Å arrow length per Å of displacement (1:1).
 *   - Input: DisplacementPair[] (from matchByNN) + per-pair primary atom
 *     position (where the arrow tail anchors).
 *
 * Same vertexColors=false guard as fix(v0.16.3) commit 0c23a2c — material
 * stays at 0xffffff base, instanceColor multiplies cleanly.
 */

const ZERO_THRESHOLD = 0.05;             // Å — arrows below this magnitude are skipped (visual noise floor)
const SCALE_DEFAULT = 1.0;
const SHAFT_RADIUS = 0.05;
const TIP_RADIUS = 0.14;
const TIP_LENGTH = 0.30;

// Viridis 4-stop approximation (same table as magneticArrowRenderer for
// consistency).
const VIRIDIS: Array<[number, number, number]> = [
  [0.267, 0.005, 0.329],
  [0.231, 0.322, 0.545],
  [0.129, 0.569, 0.549],
  [0.992, 0.906, 0.144],
];

function interpStops(t: number, stops: Array<[number, number, number]>): [number, number, number] {
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const seg = t * (stops.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

export class DisplacementArrowRenderer {
  readonly group = new THREE.Group();
  private shaftGeo: THREE.CylinderGeometry;
  private tipGeo: THREE.ConeGeometry;
  private shaftMat: THREE.MeshPhongMaterial;
  private tipMat: THREE.MeshPhongMaterial;

  constructor() {
    this.shaftGeo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, 1, 12, 1, false);
    this.tipGeo = new THREE.ConeGeometry(TIP_RADIUS, TIP_LENGTH, 16);
    // Base white so instanceColor multiplies cleanly. NO vertexColors:true
    // (see fix(v0.16.3) commit 0c23a2c — that flag would zero the diffuse).
    this.shaftMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
    this.tipMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
  }

  rebuild(pairs: DisplacementPair[], primaryPos: [number, number, number][], scale: number = SCALE_DEFAULT): void {
    this.clear();
    if (pairs.length === 0) return;

    // Filter zero/near-zero displacements + compute maxMag for colormap.
    interface Live { pos: [number, number, number]; dir: [number, number, number]; mag: number; }
    const live: Live[] = [];
    let maxMag = 0;
    for (const p of pairs) {
      const d = p.displacement;
      const mag = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      if (mag < ZERO_THRESHOLD) continue;
      if (mag > maxMag) maxMag = mag;
      live.push({ pos: primaryPos[p.a], dir: d, mag });
    }
    if (live.length === 0) return;
    if (maxMag < ZERO_THRESHOLD) maxMag = 1;

    const shaftMesh = new THREE.InstancedMesh(this.shaftGeo, this.shaftMat, live.length);
    const tipMesh = new THREE.InstancedMesh(this.tipGeo, this.tipMat, live.length);
    shaftMesh.frustumCulled = true;
    tipMesh.frustumCulled = true;

    const yAxis = new THREE.Vector3(0, 1, 0);
    const dirV = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const sm = new THREE.Matrix4();
    const tm = new THREE.Matrix4();
    const tmpColor = new THREE.Color();

    for (let i = 0; i < live.length; i++) {
      const inst = live[i];
      const len = inst.mag * scale;
      dirV.set(inst.dir[0], inst.dir[1], inst.dir[2]).normalize();
      quat.setFromUnitVectors(yAxis, dirV);

      // Shaft: midpoint of pair[a] → pair[a]+displacement, scaleY=length
      sm.compose(
        new THREE.Vector3(
          inst.pos[0] + 0.5 * len * dirV.x,
          inst.pos[1] + 0.5 * len * dirV.y,
          inst.pos[2] + 0.5 * len * dirV.z,
        ),
        quat,
        new THREE.Vector3(1, len, 1),
      );
      shaftMesh.setMatrixAt(i, sm);

      // Tip: at the displaced end (pos + len * dir)
      tm.compose(
        new THREE.Vector3(
          inst.pos[0] + len * dirV.x,
          inst.pos[1] + len * dirV.y,
          inst.pos[2] + len * dirV.z,
        ),
        quat,
        new THREE.Vector3(1, 1, 1),
      );
      tipMesh.setMatrixAt(i, tm);

      const c = interpStops(inst.mag / maxMag, VIRIDIS);
      tmpColor.setRGB(c[0], c[1], c[2]);
      shaftMesh.setColorAt(i, tmpColor);
      tipMesh.setColorAt(i, tmpColor);
    }

    shaftMesh.instanceMatrix.needsUpdate = true;
    tipMesh.instanceMatrix.needsUpdate = true;
    if (shaftMesh.instanceColor) shaftMesh.instanceColor.needsUpdate = true;
    if (tipMesh.instanceColor) tipMesh.instanceColor.needsUpdate = true;
    shaftMesh.computeBoundingSphere();
    tipMesh.computeBoundingSphere();

    this.group.add(shaftMesh, tipMesh);
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      // Geometry + materials are shared, dispose only on dispose().
    }
  }

  dispose(): void {
    this.clear();
    this.shaftGeo.dispose();
    this.tipGeo.dispose();
    this.shaftMat.dispose();
    this.tipMat.dispose();
  }
}
