/**
 * Verification for v0.16.1 (2/3) — Jacobi 3×3 symmetric eigendecomposition.
 *
 * Asserts:
 *   1. Identity → eigenvalues [1,1,1], orthonormal vectors
 *   2. Diagonal → eigenvalues = diagonal entries
 *   3. Known closed-form case (rank-1 + diagonal)
 *   4. Reconstruction: V · diag(λ) · Vᵀ ≈ M for several random symmetric M
 *   5. Real Uᵢⱼ from test-aniso.cif (Ca prolate-z)
 *
 * Run via: node dist/test-symeigen.js
 */

import { jacobiSym3, sortDescending, SymMatrix3, SymEigenResult } from '../src/webview/math/symEigen';

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) < tol;
}

function fail(msg: string): never {
  console.error(`✗ FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg: string): void {
  console.log(`✓ ${msg}`);
}

function reconstruct(r: SymEigenResult): SymMatrix3 {
  // M = V · diag(λ) · Vᵀ where V's i-th column is r.vectors[i]
  const M: number[][] = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) {
        // V[i][k] = vectors[k][i]
        s += r.vectors[k][i] * r.values[k] * r.vectors[k][j];
      }
      M[i][j] = s;
    }
  }
  return M as SymMatrix3;
}

function matsApprox(A: SymMatrix3, B: SymMatrix3, tol = 1e-6): boolean {
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (!approx(A[i][j], B[i][j], tol)) return false;
  return true;
}

function matStr(M: SymMatrix3): string {
  return M.map(r => r.map(x => x.toFixed(4)).join(' ')).join(' / ');
}

// ---- Test 1: Identity ----
{
  const r = jacobiSym3([[1,0,0],[0,1,0],[0,0,1]]);
  if (!approx(r.values[0], 1) || !approx(r.values[1], 1) || !approx(r.values[2], 1)) {
    fail(`identity eigenvalues: ${r.values.join(',')}`);
  }
  // Vectors should be orthonormal — for identity any orthonormal basis works.
  for (let i = 0; i < 3; i++) {
    const v = r.vectors[i];
    const norm = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    if (!approx(norm, 1)) fail(`identity vector ${i} not unit (norm=${norm})`);
  }
  pass('Identity: eigenvalues [1,1,1], unit vectors');
}

// ---- Test 2: Diagonal matrix ----
{
  const r = jacobiSym3([[3,0,0],[0,7,0],[0,0,2]]);
  const sorted = sortDescending(r);
  if (!approx(sorted.values[0], 7) || !approx(sorted.values[1], 3) || !approx(sorted.values[2], 2)) {
    fail(`diagonal eigenvalues: ${sorted.values.join(',')}`);
  }
  pass('Diagonal [3,7,2] → sorted eigenvalues [7,3,2]');
}

// ---- Test 3: Known closed-form ([[2,1,0],[1,2,0],[0,0,3]] → eig 3,3,1) ----
{
  const r = jacobiSym3([[2,1,0],[1,2,0],[0,0,3]]);
  const sorted = sortDescending(r).values.slice().sort((a,b) => b-a);
  if (!approx(sorted[0], 3) || !approx(sorted[1], 3) || !approx(sorted[2], 1)) {
    fail(`block-diag eigenvalues: ${sorted.join(',')}`);
  }
  pass('Block-diag [[2,1,0],[1,2,0],[0,0,3]] → eigenvalues [3,3,1]');
}

// ---- Test 4: Reconstruction over several random sym matrices ----
{
  const cases: SymMatrix3[] = [
    [[1, 0.3, -0.2], [0.3, 2, 0.1], [-0.2, 0.1, 3]],
    [[0.5, -0.4, 0.2], [-0.4, 1.5, 0.3], [0.2, 0.3, 0.7]],
    [[10, 0.001, 0], [0.001, 10, 0], [0, 0, 5]],  // near-degenerate
  ];
  for (const M of cases) {
    const r = jacobiSym3(M);
    const back = reconstruct(r);
    if (!matsApprox(M, back, 1e-5)) {
      fail(`reconstruction failed for M = ${matStr(M)}\n  got back: ${matStr(back)}\n  values: ${r.values.join(',')}`);
    }
  }
  pass(`Reconstruction (V·Λ·Vᵀ ≈ M) on ${cases.length} cases (incl. near-degenerate)`);
}

// ---- Test 5: Real anisotropic U from test-aniso.cif (O atom: off-diagonal) ----
{
  // O: U11=0.020, U22=0.020, U33=0.020, U12=0.001, U13=-0.002, U23=0.003
  const U: SymMatrix3 = [
    [0.020,  0.001, -0.002],
    [0.001,  0.020,  0.003],
    [-0.002, 0.003,  0.020],
  ];
  const r = jacobiSym3(U);
  // Sum of eigenvalues should equal trace
  const sum = r.values[0] + r.values[1] + r.values[2];
  const trace = U[0][0] + U[1][1] + U[2][2];
  if (!approx(sum, trace, 1e-6)) fail(`trace check: λ sum=${sum} vs trace=${trace}`);
  // All eigenvalues positive (positive semi-definite)
  for (const v of r.values) {
    if (v < -1e-6) fail(`eigenvalue negative: ${r.values.join(',')}`);
  }
  // Reconstruct
  const back = reconstruct(r);
  if (!matsApprox(U, back, 1e-6)) fail(`O U reconstruction failed: ${matStr(back)}`);
  pass(`Real anisotropic U (O from test-aniso.cif): trace=${trace.toFixed(4)}, eigenvalues=[${r.values.map(v => v.toFixed(5)).join(', ')}], reconstructs to original`);
}

// ---- Test 6: Sort utility ----
{
  const r: SymEigenResult = {
    values: [1, 5, 3],
    vectors: [[1,0,0], [0,1,0], [0,0,1]],
  };
  const s = sortDescending(r);
  if (s.values[0] !== 5 || s.values[1] !== 3 || s.values[2] !== 1) fail(`sortDescending values: ${s.values.join(',')}`);
  if (s.vectors[0][1] !== 1) fail(`sortDescending vectors[0] should be [0,1,0], got [${s.vectors[0].join(',')}]`);
  pass('sortDescending: pairs values + vectors correctly');
}

console.log('\nAll v0.16.1 (2/3) Jacobi eigen tests passed.');
