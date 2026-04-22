import * as THREE from 'three';
import { jacobiSym3, SymMatrix3 } from './math/symEigen';

/**
 * Thermal-ellipsoid renderer (v0.16.1).
 *
 * Renders one InstancedMesh per element where each instance is a unit
 * sphere transformed by  T(center) · R · diag(r₁, r₂, r₃)  to take the
 * shape of the displacement-tensor probability surface. The U_ij tensor
 * (Å²) is decomposed to eigenvalues λᵢ; semi-axes are
 *   rᵢ = scale · sqrt(max(λᵢ, 0))
 * with scale = sqrt(2.366) for the 50% probability contour or
 * sqrt(6.251) for 90% (χ²₃ table, hard-coded — no erfc lib pulled in).
 *
 * Phong material is forced (no impostor): the sphere-impostor shader
 * assumes uniform radius via instanceMatrix; an axis-scaled ellipsoid
 * would distort its ray-sphere test. Per-instance impostor for ellipsoids
 * is deferred (plan §결정 게이트 #1).
 *
 * The caller passes Uᵢⱼ in Å² (no rotation by symmetry op applied in
 * v0.16.1 first cut — see cifParser.ts §J2 limitation).
 */

export type Uij = { U11: number; U22: number; U33: number; U12: number; U13: number; U23: number };

export interface EllipsoidInstance {
  position: [number, number, number];  // cartesian center in Å
  uij: Uij;                              // anisotropic displacement tensor (Å²)
}

// χ²₃ inverse CDF quantiles — hard-coded so we don't drag erfc into the bundle.
//   χ²₃(0.5) ≈ 2.366   → 50% probability ellipsoid (median surface)
//   χ²₃(0.9) ≈ 6.251   → 90% probability ellipsoid
const CONTOUR_50 = Math.sqrt(2.366);
const CONTOUR_90 = Math.sqrt(6.251);

export type ProbabilityContour = 0.5 | 0.9;

export class EllipsoidRenderer {
  readonly group = new THREE.Group();
  private materials = new Map<string, THREE.MeshPhongMaterial>();
  private sphereGeo: THREE.BufferGeometry;
  private contour: ProbabilityContour = 0.5;

  constructor() {
    // Single shared unit-radius sphere geometry; instances scale via Matrix4.
    // 24×16 segments balances ellipsoid smoothness against InstancedMesh cost
    // for typical structures (≤ a few hundred ellipsoid sites).
    this.sphereGeo = new THREE.SphereGeometry(1, 24, 16);
  }

  setProbabilityContour(c: ProbabilityContour) {
    this.contour = c;
  }

  getProbabilityContour(): ProbabilityContour {
    return this.contour;
  }

  /**
   * Build ellipsoid meshes from `instances` grouped by element symbol.
   * Caller must dispose the previous build via `clear()` before re-building.
   */
  rebuild(elementGroups: Map<string, EllipsoidInstance[]>, getColor: (el: string) => string): void {
    this.clear();
    const scale = this.contour === 0.9 ? CONTOUR_90 : CONTOUR_50;

    for (const [element, items] of elementGroups) {
      if (items.length === 0) continue;
      const color = getColor(element);
      const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), shininess: 30 });
      this.materials.set(element, mat);
      const mesh = new THREE.InstancedMesh(this.sphereGeo, mat, items.length);
      // Default InstancedMesh frustum check unions per-instance bounds; OK for
      // ellipsoids since their bounding sphere never exceeds 2 × largest semi-axis.
      mesh.frustumCulled = true;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < items.length; i++) {
        const m = computeEllipsoidMatrix(items[i], scale);
        matrix.fromArray(m);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Tear down meshes and per-element materials. Geometry is shared and
   * disposed only on dispose().
   */
  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      // InstancedMesh's geometry is shared — don't dispose it here.
    }
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
  }

  dispose(): void {
    this.clear();
    this.sphereGeo.dispose();
  }
}

/**
 * Build a column-major 4×4 transform mapping a unit sphere to the
 * probability ellipsoid for one site:  M = T(c) · R · S(r₁, r₂, r₃).
 * Returns 16-element Float32-style array (Three's Matrix4.fromArray order).
 */
export function computeEllipsoidMatrix(inst: EllipsoidInstance, scale: number): number[] {
  const { U11, U22, U33, U12, U13, U23 } = inst.uij;
  const Umat: SymMatrix3 = [
    [U11, U12, U13],
    [U12, U22, U23],
    [U13, U23, U33],
  ];
  const eig = jacobiSym3(Umat);

  // PSD enforcement: physical Uᵢⱼ has λ ≥ 0; numerical drift may produce
  // tiny negatives. Clamp + warn loudly enough to see in dev console but not
  // spam for routine borderline cases (warn on |λ| > 1e-4 only).
  const r0 = Math.sqrt(Math.max(eig.values[0], 0));
  const r1 = Math.sqrt(Math.max(eig.values[1], 0));
  const r2 = Math.sqrt(Math.max(eig.values[2], 0));
  for (const lam of eig.values) {
    if (lam < -1e-4) {
      // eslint-disable-next-line no-console
      console.warn(`[ellipsoid] non-PSD Uᵢⱼ encountered, λ=${lam}; clamping at 0. Site:`, inst.position);
      break;
    }
  }

  // Eigenvectors in columns: vectors[k][i] is the i-th component of the k-th
  // eigenvector. Build R = [v0 v1 v2] as columns.
  const v0 = eig.vectors[0];
  const v1 = eig.vectors[1];
  const v2 = eig.vectors[2];

  // Ensure right-handed: if det(R) < 0, flip last column (swap with sign of
  // last semi-axis). Eigenvectors are sign-ambiguous so this is benign.
  const det =
    v0[0] * (v1[1] * v2[2] - v1[2] * v2[1]) -
    v0[1] * (v1[0] * v2[2] - v1[2] * v2[0]) +
    v0[2] * (v1[0] * v2[1] - v1[1] * v2[0]);
  if (det < 0) {
    v2[0] = -v2[0]; v2[1] = -v2[1]; v2[2] = -v2[2];
  }

  // Three.js Matrix4 uses column-major storage in Float32-like flat array.
  // M = T · R · S where S = diag(scale·r0, scale·r1, scale·r2, 1).
  // Each column of M is (R column · semi-axis-length, 0) for x/y/z and
  // (center, 1) for translation.
  const sx = scale * r0;
  const sy = scale * r1;
  const sz = scale * r2;
  const c = inst.position;

  return [
    v0[0] * sx, v0[1] * sx, v0[2] * sx, 0,
    v1[0] * sy, v1[1] * sy, v1[2] * sy, 0,
    v2[0] * sz, v2[1] * sz, v2[2] * sz, 0,
    c[0],       c[1],       c[2],       1,
  ];
}
