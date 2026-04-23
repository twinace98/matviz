/**
 * Verification for v0.17.1 (17.3.0) — NN atom matching.
 *
 * Asserts:
 *   1. Identity: same atoms in same order → all i↔i, displacement [0,0,0]
 *   2. Uniform drift: secondary = primary + (0.5, 0, 0) → all i↔i, disp = [0.5,0,0]
 *   3. Swap: two same-species atoms swapped → matching by position is correct
 *   4. Large-N spatial bin: 200 random atoms, secondary is shuffled primary →
 *      all displacement [0,0,0] within tol (correctness of bin path)
 *
 * Run via: node dist/test-nn-matching.js
 */

import { matchByNN } from '../src/webview/nnMatching';

function approx(a: number, b: number, tol = 1e-6): boolean { return Math.abs(a - b) < tol; }
function fail(msg: string): never { console.error(`✗ FAIL: ${msg}`); process.exit(1); }
function pass(msg: string): void { console.log(`✓ ${msg}`); }

// ---- Test 1: Identity ----
{
  const species = ['Na', 'Cl', 'Na', 'Cl'];
  const pos: [number, number, number][] = [[0,0,0], [1,0,0], [2,0,0], [3,0,0]];
  const r = matchByNN(species, pos, species, pos);
  if (r.unmatched.length !== 0) fail(`identity: unexpected unmatched ${r.unmatched}`);
  if (r.pairs.length !== 4) fail(`identity: expected 4 pairs, got ${r.pairs.length}`);
  for (const p of r.pairs) {
    if (p.a !== p.b) fail(`identity: pair (${p.a}, ${p.b}) — should map i→i`);
    if (!approx(p.displacement[0], 0) || !approx(p.displacement[1], 0) || !approx(p.displacement[2], 0)) {
      fail(`identity: nonzero displacement ${p.displacement}`);
    }
  }
  pass('Identity: all pairs i↔i with zero displacement');
}

// ---- Test 2: Uniform drift ----
{
  const species = ['Na', 'Na', 'Cl'];
  const primary: [number, number, number][] = [[0,0,0], [1,0,0], [2,0,0]];
  const secondary: [number, number, number][] = [[0.5,0,0], [1.5,0,0], [2.5,0,0]];
  const r = matchByNN(species, primary, species, secondary);
  if (r.unmatched.length !== 0) fail(`drift: unexpected unmatched`);
  for (const p of r.pairs) {
    if (p.a !== p.b) fail(`drift: pair (${p.a}, ${p.b}) — expected i→i (NN preserves order under uniform shift)`);
    if (!approx(p.displacement[0], 0.5)) fail(`drift: dx = ${p.displacement[0]}, expected 0.5`);
  }
  pass('Uniform drift (0.5, 0, 0): all pairs i↔i, displacement [0.5, 0, 0]');
}

// ---- Test 3: Swap ----
{
  // Two Na atoms swap positions in secondary; Cl unchanged.
  const species = ['Na', 'Na', 'Cl'];
  const primary: [number, number, number][] = [[0,0,0], [10,0,0], [5,0,0]];
  const secondary: [number, number, number][] = [[10,0,0], [0,0,0], [5,0,0]];
  // Use a large threshold so both Na atoms are within range
  const r = matchByNN(species, primary, species, secondary, 20.0);
  if (r.unmatched.length !== 0) fail(`swap: unexpected unmatched`);
  // primary[0] (Na at 0) should match secondary[1] (Na at 0) — distance 0
  // primary[1] (Na at 10) should match secondary[0] (Na at 10) — distance 0
  // primary[2] (Cl at 5) should match secondary[2] (Cl at 5)
  const map = new Map(r.pairs.map(p => [p.a, p.b]));
  if (map.get(0) !== 1) fail(`swap: primary[0] should match secondary[1] (Na at 0), got ${map.get(0)}`);
  if (map.get(1) !== 0) fail(`swap: primary[1] should match secondary[0] (Na at 10), got ${map.get(1)}`);
  if (map.get(2) !== 2) fail(`swap: primary[2] (Cl) should match secondary[2], got ${map.get(2)}`);
  for (const p of r.pairs) {
    for (const d of p.displacement) {
      if (!approx(d, 0)) fail(`swap: displacement should be ~0 after correct matching, got ${p.displacement}`);
    }
  }
  pass('Swap: NN by position correctly maps swapped Na atoms; Cl unchanged');
}

// ---- Test 4: Large-N spatial bin ----
{
  const N = 200;
  const species = new Array(N).fill('C');
  // Random positions in 50³ box (deterministic seed via simple LCG so test
  // is reproducible)
  let seed = 12345;
  function rand(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  const primary: [number, number, number][] = [];
  for (let i = 0; i < N; i++) {
    primary.push([rand() * 50, rand() * 50, rand() * 50]);
  }
  // Secondary = shuffled primary (Fisher-Yates)
  const order = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const secondary: [number, number, number][] = order.map(idx => primary[idx]);

  const r = matchByNN(species, primary, species, secondary, 0.1);  // tight threshold — only exact match
  if (r.unmatched.length !== 0) fail(`large-N bin: unexpected unmatched (${r.unmatched.length})`);
  if (r.pairs.length !== N) fail(`large-N bin: expected ${N} pairs, got ${r.pairs.length}`);
  // All displacements should be exactly zero (same atom, just reindexed)
  for (const p of r.pairs) {
    for (const d of p.displacement) {
      if (Math.abs(d) > 1e-9) fail(`large-N bin: nonzero displacement ${d} for pair (${p.a}, ${p.b})`);
    }
  }
  pass(`Large-N spatial bin: ${N} random atoms, secondary = shuffled primary, all displacements = 0`);
}

// ---- Test 5: PBC-aware (17.2.2) — atom wraps across cell boundary ----
{
  // 4Å cubic cell. Primary Na near +x face (frac 0.99 → cart 3.96).
  // Secondary Na slightly past the boundary (frac 0.01 in next cell →
  // cart 0.04 if wrapped to home cell; or cart 4.04 representing image).
  // Test: secondary at cart 0.04 (atom wrapped). Without PBC, raw
  // distance ≈ 3.92Å (fails 2.0 threshold). With PBC, minimum-image
  // distance ≈ 0.08Å (matches).
  const lattice: [number, number, number][] = [
    [4, 0, 0], [0, 4, 0], [0, 0, 4],
  ];
  const species = ['Na'];
  const primary: [number, number, number][] = [[3.96, 0, 0]];
  const secondary: [number, number, number][] = [[0.04, 0, 0]];

  // Without PBC: should fail (distance 3.92Å > 2.0Å threshold)
  const noPbc = matchByNN(species, primary, species, secondary);
  if (noPbc.unmatched.length !== 1) fail(`PBC test: without lattice, expected 1 unmatched (raw distance 3.92), got ${noPbc.unmatched.length}`);

  // With PBC: should match (minimum-image distance 0.08Å)
  const withPbc = matchByNN(species, primary, species, secondary, 2.0, lattice);
  if (withPbc.unmatched.length !== 0) fail(`PBC test: with lattice, atom should match across boundary`);
  if (withPbc.pairs.length !== 1) fail(`PBC test: expected 1 pair, got ${withPbc.pairs.length}`);
  // Displacement should be small (~ -0.08Å in x), not large (-3.92Å)
  const disp = withPbc.pairs[0].displacement;
  const mag = Math.sqrt(disp[0]*disp[0] + disp[1]*disp[1] + disp[2]*disp[2]);
  if (mag > 0.5) fail(`PBC test: displacement magnitude ${mag.toFixed(4)} too large — minimum-image not applied`);
  if (Math.abs(mag - 0.08) > 1e-4) fail(`PBC test: displacement magnitude ${mag.toFixed(4)}, expected ~0.08`);
  pass(`PBC: cell-wrap atom match — without lattice unmatched (raw 3.92Å), with lattice matched (min-image 0.08Å)`);
}

console.log('\nAll v0.17.1.0 + 17.2.2 NN-matching tests passed.');
