/**
 * Eigendecomposition of a 3×3 real symmetric matrix via cyclic Jacobi
 * rotations. Used by v0.16.1 to convert anisotropic-displacement tensors
 * Uᵢⱼ into ellipsoid principal axes (eigenvalues = squared semi-axis
 * lengths in some scale; eigenvectors = principal directions).
 *
 * Three.js's Matrix3 has no eigen routine and the symmetric case admits
 * a stable ~30-line direct solver, so no external dependency is needed.
 *
 * Convergence: cyclic Jacobi sweeps the three off-diagonal pairs (0,1),
 * (0,2), (1,2) per iteration, zeroing each via a Givens rotation. For
 * symmetric input it converges quadratically; SCF threshold 1e-10 on the
 * sum of squared off-diagonals is hit in ≲ 6 iterations for typical
 * Uᵢⱼ tensors.
 *
 * Output:
 *   values  — eigenvalues (NOT sorted; use sortDescending if needed)
 *   vectors — column-major-as-rows: vectors[i] is the i-th eigenvector
 *             (so eigenvector for values[i] is vectors[i])
 *
 * For physical Uᵢⱼ (positive semi-definite by construction) all values
 * should be ≥ 0. Numerical drift can produce tiny negatives; callers
 * should clamp at 0 before sqrt.
 */

export type SymMatrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export type Vec3 = [number, number, number];

export interface SymEigenResult {
  values: [number, number, number];
  vectors: [Vec3, Vec3, Vec3];
}

const MAX_SWEEPS = 50;
const TOL = 1e-10;

export function jacobiSym3(M: SymMatrix3): SymEigenResult {
  // Working copies. A is reduced toward diagonal; V accumulates
  // rotations so that A_orig = V · diag(values) · Vᵀ.
  const A: number[][] = [
    [M[0][0], M[0][1], M[0][2]],
    [M[1][0], M[1][1], M[1][2]],
    [M[2][0], M[2][1], M[2][2]],
  ];
  const V: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    const off = A[0][1] * A[0][1] + A[0][2] * A[0][2] + A[1][2] * A[1][2];
    if (off < TOL) break;

    // Cyclic order: (p, q) = (0,1), (0,2), (1,2)
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = A[p][q];
        if (Math.abs(apq) < TOL) continue;

        // Compute Givens rotation: tan(2θ) = 2·apq / (app − aqq).
        const app = A[p][p];
        const aqq = A[q][q];
        let t: number;
        if (Math.abs(app - aqq) < 1e-30) {
          t = apq >= 0 ? 1 : -1;  // θ = π/4
        } else {
          const theta = (aqq - app) / (2 * apq);
          // Stable branch: t = sign(θ) / (|θ| + sqrt(θ² + 1))
          const sgn = theta >= 0 ? 1 : -1;
          t = sgn / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        }
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const tau = s / (1 + c);

        // Update A: zero apq and aqp, adjust diagonals and other off-diagonals.
        A[p][p] = app - t * apq;
        A[q][q] = aqq + t * apq;
        A[p][q] = 0;
        A[q][p] = 0;

        // Adjust the third column/row (index r ≠ p, q).
        const r = 3 - p - q;
        const arp = A[r][p];
        const arq = A[r][q];
        A[r][p] = arp - s * (arq + tau * arp);
        A[p][r] = A[r][p];
        A[r][q] = arq + s * (arp - tau * arq);
        A[q][r] = A[r][q];

        // Accumulate eigenvectors: V = V · J(p,q,θ)
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = vkp - s * (vkq + tau * vkp);
          V[k][q] = vkq + s * (vkp - tau * vkq);
        }
      }
    }
  }

  // V's columns are eigenvectors. Return as rows of `vectors` so that
  // vectors[i] aligns with values[i] for caller convenience.
  return {
    values: [A[0][0], A[1][1], A[2][2]],
    vectors: [
      [V[0][0], V[1][0], V[2][0]],
      [V[0][1], V[1][1], V[2][1]],
      [V[0][2], V[1][2], V[2][2]],
    ],
  };
}

/**
 * Sort eigenpairs by descending eigenvalue. Useful for selecting the
 * "long axis" first when building an ellipsoid frame.
 */
export function sortDescending(r: SymEigenResult): SymEigenResult {
  const idx = [0, 1, 2].sort((a, b) => r.values[b] - r.values[a]) as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  return {
    values: [r.values[idx[0]], r.values[idx[1]], r.values[idx[2]]],
    vectors: [r.vectors[idx[0]], r.vectors[idx[1]], r.vectors[idx[2]]],
  };
}
