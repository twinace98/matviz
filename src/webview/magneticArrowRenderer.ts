import * as THREE from 'three';

/**
 * Magnetic moment vector renderer (v0.16.3).
 *
 * Each non-zero per-atom moment is drawn as an arrow centered on the atom:
 *   - shaft: thin cylinder (length = |m| × scale)
 *   - tip:   cone glued to the shaft end, fixed size
 *
 * Both shaft and tip are InstancedMesh per element so a structure with
 * tens or hundreds of moment vectors costs O(2) draw calls regardless
 * of count. Per-instance color (instanceColor) carries a colormap value
 * derived from |m| so up/down sites visually contrast.
 *
 * The full vector (vector → world-space transform) goes into the
 * instance matrix; the geometries are unit-aligned to the +z axis and
 * we rotate via Quaternion.setFromUnitVectors(z, m̂).
 */

export interface MagneticArrowInstance {
  position: [number, number, number];
  moment: [number, number, number];   // Cartesian, μB
}

export type Colormap = 'redblue' | 'viridis';

const ZERO_THRESHOLD = 1e-4;          // moments below this are skipped (no arrow)
// Scale: 1 Å of arrow length per μB. Tuned for typical 2–4 μB systems where
// arrows comfortably overlay the atomic radius without dominating the cell.
const SCALE_ANGSTROM_PER_MUB = 1.0;
const SHAFT_RADIUS = 0.06;
const TIP_RADIUS = 0.18;
const TIP_LENGTH = 0.35;

export class MagneticArrowRenderer {
  readonly group = new THREE.Group();
  private shaftGeo: THREE.CylinderGeometry;
  private tipGeo: THREE.ConeGeometry;
  private shaftMat: THREE.MeshPhongMaterial;
  private tipMat: THREE.MeshPhongMaterial;
  private colormap: Colormap = 'redblue';

  constructor() {
    // Shaft: unit-height cylinder along +y in Three's convention; we'll
    // rotate +y → moment direction in setFromUnitVectors.
    this.shaftGeo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, 1, 12, 1, false);
    this.tipGeo = new THREE.ConeGeometry(TIP_RADIUS, TIP_LENGTH, 16);
    // White base color; instanceColor automatically multiplies via Three's
    // USE_INSTANCING_COLOR shader define when InstancedMesh.instanceColor is
    // non-null. DO NOT set vertexColors:true — that activates the separate
    // USE_COLOR path which expects a `color` BufferAttribute on the geometry
    // (cylinder/cone don't have one), and the resulting `vColor *= 0` zeroes
    // the diffuse → arrows render solid black regardless of instanceColor.
    this.shaftMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
    this.tipMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30 });
  }

  setColormap(c: Colormap) { this.colormap = c; }
  getColormap(): Colormap { return this.colormap; }

  /**
   * Rebuild meshes from a flat instance list. Caller filters out zero
   * moments before passing in (so we don't waste InstancedMesh slots).
   */
  rebuild(instances: MagneticArrowInstance[]): void {
    this.clear();
    if (instances.length === 0) return;

    // Filter out zero moments (defensive — caller should already)
    const live = instances.filter(inst => length3(inst.moment) >= ZERO_THRESHOLD);
    if (live.length === 0) return;

    // Determine maxMag for colormap normalization.
    let maxMag = 0;
    for (const inst of live) {
      const m = length3(inst.moment);
      if (m > maxMag) maxMag = m;
    }
    if (maxMag < ZERO_THRESHOLD) maxMag = 1; // avoid divide-by-zero

    const shaftMesh = new THREE.InstancedMesh(this.shaftGeo, this.shaftMat, live.length);
    const tipMesh = new THREE.InstancedMesh(this.tipGeo, this.tipMat, live.length);
    shaftMesh.frustumCulled = true;
    tipMesh.frustumCulled = true;

    const yAxis = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const shaftMat = new THREE.Matrix4();
    const tipMat = new THREE.Matrix4();
    const tempColor = new THREE.Color();

    for (let i = 0; i < live.length; i++) {
      const inst = live[i];
      const mag = length3(inst.moment);
      const len = mag * SCALE_ANGSTROM_PER_MUB;
      dir.set(inst.moment[0], inst.moment[1], inst.moment[2]).normalize();
      quat.setFromUnitVectors(yAxis, dir);

      // Shaft: positioned at center along moment, scaled to (radius,len,radius).
      // The cylinder geometry runs ±0.5 in y, so center sits at atom + len/2 · dir.
      const cx = inst.position[0] + 0.5 * len * dir.x;
      const cy = inst.position[1] + 0.5 * len * dir.y;
      const cz = inst.position[2] + 0.5 * len * dir.z;
      shaftMat.compose(new THREE.Vector3(cx, cy, cz), quat, new THREE.Vector3(1, len, 1));
      shaftMesh.setMatrixAt(i, shaftMat);

      // Tip: positioned at shaft end (atom + len · dir), default scale.
      const tx = inst.position[0] + len * dir.x;
      const ty = inst.position[1] + len * dir.y;
      const tz = inst.position[2] + len * dir.z;
      tipMat.compose(new THREE.Vector3(tx, ty, tz), quat, new THREE.Vector3(1, 1, 1));
      tipMesh.setMatrixAt(i, tipMat);

      // Color from sign(moment·z) for redblue, else from |m| / maxMag for sequential.
      const c = colormapValue(this.colormap, inst.moment, mag, maxMag);
      tempColor.setRGB(c[0], c[1], c[2]);
      shaftMesh.setColorAt(i, tempColor);
      tipMesh.setColorAt(i, tempColor);
    }
    shaftMesh.instanceMatrix.needsUpdate = true;
    tipMesh.instanceMatrix.needsUpdate = true;
    if (shaftMesh.instanceColor) shaftMesh.instanceColor.needsUpdate = true;
    if (tipMesh.instanceColor) tipMesh.instanceColor.needsUpdate = true;
    shaftMesh.computeBoundingSphere();
    tipMesh.computeBoundingSphere();

    this.group.add(shaftMesh, tipMesh);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      // Geometries + materials are shared; don't dispose here.
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

function length3(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Colormap dispatch. Returns RGB triple in [0, 1].
 *   redblue: sign-coded — positive moment-z → red, negative → blue, with
 *            saturation by |m|/maxMag. Best for collinear AFM/FM systems.
 *   viridis: sequential by magnitude (perceptually uniform-ish 4-stop).
 */
function colormapValue(map: Colormap, moment: [number, number, number], mag: number, maxMag: number): [number, number, number] {
  const t = mag / maxMag;
  if (map === 'viridis') {
    // 4-stop approximation: 0=#440154, 0.33=#3b528b, 0.67=#21918c, 1=#fde725
    return interpStops(t, [
      [0.267, 0.005, 0.329],
      [0.231, 0.322, 0.545],
      [0.129, 0.569, 0.549],
      [0.992, 0.906, 0.144],
    ]);
  }
  // redblue diverging: scale dominant component sign by saturation
  const sign = moment[2] >= 0 ? 1 : -1;
  if (sign > 0) {
    return [1.0, 1.0 - t, 1.0 - t];   // white→red
  }
  return [1.0 - t, 1.0 - t, 1.0];     // white→blue
}

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
