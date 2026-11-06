/**
 * Verification for CrystalTrajectory data contract + parser bridge.
 * Run via: node dist/test-trajectory.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseStructureFile, parseStructureFileTraj } from '../src/parsers/index';

const ROOT = process.cwd();

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }
function pass(msg: string): void { console.log(`PASS: ${msg}`); }

// ---- Test 1: single-frame CIF wraps into 1-frame trajectory ----
{
  const p = path.join(ROOT, 'test/fixtures/nacl.cif');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'nacl.cif').trajectory;
  if (traj.frames.length !== 1) fail(`nacl.cif: expected 1 frame, got ${traj.frames.length}`);
  if (traj.latticeMode !== 'fixed') fail(`nacl.cif: latticeMode should be 'fixed', got '${traj.latticeMode}'`);
  if (traj.frames[0].species.length === 0) fail(`nacl.cif: frame 0 has no atoms (parser regression)`);
  pass(`nacl.cif: wrapped into 1-frame trajectory (latticeMode=fixed, ${traj.frames[0].species.length} atoms)`);
}

// ---- Test 2: trajectory frame[0] equals direct parser output ----
{
  const p = path.join(ROOT, 'test/fixtures/silicon.poscar');
  const content = fs.readFileSync(p, 'utf8');
  const direct = parseStructureFile(content, 'silicon.poscar').structure;
  const wrapped = parseStructureFileTraj(content, 'silicon.poscar').trajectory.frames[0];
  if (direct.species.length !== wrapped.species.length) {
    fail(`silicon.poscar: direct ${direct.species.length} vs wrapped ${wrapped.species.length} atoms`);
  }
  for (let i = 0; i < direct.species.length; i++) {
    if (direct.species[i] !== wrapped.species[i]) {
      fail(`silicon.poscar: species[${i}] differs ${direct.species[i]} vs ${wrapped.species[i]}`);
    }
  }
  pass(`silicon.poscar: trajectory.frames[0] matches direct parseStructureFile output`);
}

// ---- Test 3: single-frame XSF (no ANIMSTEPS) still produces length-1 ----
{
  const p = path.join(ROOT, 'test/fixtures/graphene.xsf');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'graphene.xsf').trajectory;
  if (traj.frames.length !== 1) {
    fail(`graphene.xsf (no ANIMSTEPS): expected 1 frame, got ${traj.frames.length}`);
  }
  if (traj.latticeMode !== 'fixed') fail(`graphene.xsf: latticeMode should be 'fixed'`);
  pass(`graphene.xsf: single-frame XSF correctly wraps as 1-frame trajectory`);
}

// ---- Test 3c: XDATCAR NVE (fixed-cell) ----
{
  const p = path.join(ROOT, 'test/fixtures/test-xdatcar-nve');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'XDATCAR').trajectory;
  if (traj.frames.length !== 5) fail(`xdatcar-nve: expected 5 frames, got ${traj.frames.length}`);
  if (traj.latticeMode !== 'fixed') fail(`xdatcar-nve: latticeMode should be 'fixed', got '${traj.latticeMode}'`);
  // Lattice REF identity (NVE fixed-cell optimization)
  for (let f = 1; f < 5; f++) {
    if (traj.frames[f].lattice !== traj.frames[0].lattice) {
      fail(`xdatcar-nve: NVE lattice ref differs at frame ${f}`);
    }
  }
  // Na drifts along x: cartesian = fractional × lattice[0][0] = f*0.01 × 5.64
  for (let f = 0; f < 5; f++) {
    const expected = f * 0.01 * 5.64;
    const actual = traj.frames[f].positions[0][0];
    if (Math.abs(actual - expected) > 1e-4) {
      fail(`xdatcar-nve: frame ${f} Na x = ${actual}, expected ${expected.toFixed(4)}`);
    }
  }
  pass(`xdatcar-nve: 5 frames, fixed lattice ref shared, Na fractional→cartesian drift correct`);
}

// ---- Test 3e: extended XYZ multi-frame ----
{
  const p = path.join(ROOT, 'test/fixtures/test-extxyz.xyz');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'test-extxyz.xyz').trajectory;
  if (traj.frames.length !== 3) fail(`extxyz: expected 3 frames, got ${traj.frames.length}`);
  if (traj.latticeMode !== 'fixed') fail(`extxyz: identical Lattice headers → expected 'fixed', got '${traj.latticeMode}'`);
  // Lattice reference shared after fixed-cell collapse
  for (let f = 1; f < 3; f++) {
    if (traj.frames[f].lattice !== traj.frames[0].lattice) {
      fail(`extxyz: lattice REF differs at frame ${f} (fixed-cell collapse failed)`);
    }
  }
  // Na drift along x: 0.0, 0.1, 0.2 (cartesian, no fractional conversion)
  for (let f = 0; f < 3; f++) {
    const expected = f * 0.1;
    if (Math.abs(traj.frames[f].positions[0][0] - expected) > 1e-5) {
      fail(`extxyz: frame ${f} Na x = ${traj.frames[f].positions[0][0]}, expected ${expected}`);
    }
  }
  // PBC detected from Lattice presence
  if (!traj.frames[0].pbc[0]) fail(`extxyz: pbc should be [true,true,true] when Lattice present`);
  pass(`extxyz: 3 frames, latticeMode=fixed (lattice REF collapsed), Na drift correct, pbc detected`);
}

// ---- Test 3f: plain XYZ (no Lattice) still works as 1-frame trajectory ----
{
  const p = path.join(ROOT, 'test/fixtures/water.xyz');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'water.xyz').trajectory;
  if (traj.frames.length !== 1) fail(`water.xyz: plain XYZ should be 1 frame, got ${traj.frames.length}`);
  pass(`water.xyz: plain XYZ wraps as 1-frame trajectory (parseXyzTraj single-frame branch)`);
}

// ---- Test 3d: XDATCAR NPT (variable-cell) ----
{
  const p = path.join(ROOT, 'test/fixtures/test-xdatcar-npt');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'XDATCAR').trajectory;
  if (traj.frames.length !== 3) fail(`xdatcar-npt: expected 3 frames, got ${traj.frames.length}`);
  if (traj.latticeMode !== 'per-frame') fail(`xdatcar-npt: should detect variable-cell, got latticeMode='${traj.latticeMode}'`);
  // Lattice grows: 5.640, 5.700, 5.760
  const expectedA = [5.640, 5.700, 5.760];
  for (let f = 0; f < 3; f++) {
    if (Math.abs(traj.frames[f].lattice[0][0] - expectedA[f]) > 1e-4) {
      fail(`xdatcar-npt: frame ${f} a=${traj.frames[f].lattice[0][0]}, expected ${expectedA[f]}`);
    }
  }
  pass(`xdatcar-npt: 3 frames, latticeMode=per-frame, lattice a grew 5.640 → 5.700 → 5.760`);
}

// ---- Test 3b: AXSF multi-frame ----
{
  const p = path.join(ROOT, 'test/fixtures/test-trajectory.axsf');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'test-trajectory.axsf').trajectory;
  if (traj.frames.length !== 4) fail(`test-trajectory.axsf: expected 4 frames, got ${traj.frames.length}`);
  if (traj.latticeMode !== 'fixed') fail(`test-trajectory.axsf: shared PRIMVEC → expected latticeMode='fixed', got '${traj.latticeMode}'`);
  // Atom invariance: same species per frame
  for (let f = 1; f < traj.frames.length; f++) {
    if (traj.frames[f].species.length !== traj.frames[0].species.length) {
      fail(`test-trajectory.axsf: frame ${f} atom count differs from frame 0`);
    }
    if (traj.frames[f].species[0] !== 'Na' || traj.frames[f].species[1] !== 'Cl') {
      fail(`test-trajectory.axsf: frame ${f} species not [Na, Cl]`);
    }
  }
  // Position drift: Na x-coord 0.0, 0.1, 0.2, 0.3 across frames
  for (let f = 0; f < 4; f++) {
    const expected = f * 0.1;
    if (Math.abs(traj.frames[f].positions[0][0] - expected) > 1e-6) {
      fail(`test-trajectory.axsf: frame ${f} Na x = ${traj.frames[f].positions[0][0]}, expected ${expected}`);
    }
  }
  // Fixed-cell optimization: all frames share lattice REFERENCE
  for (let f = 1; f < 4; f++) {
    if (traj.frames[f].lattice !== traj.frames[0].lattice) {
      fail(`test-trajectory.axsf: latticeMode='fixed' but frame ${f} lattice ref differs from frame 0`);
    }
  }
  pass(`test-trajectory.axsf: 4 frames, latticeMode=fixed (shared ref), Na drifting along x as expected`);
}

// ---- Test 4: existing parser tests still green (regression check) ----
//      Direct parseStructureFile path untouched.
{
  const fixtures = ['nacl.cif', 'silicon.poscar', 'tio2-rutile.cif', 'graphene.xsf'];
  for (const f of fixtures) {
    const p = path.join(ROOT, 'test/fixtures/', f);
    const content = fs.readFileSync(p, 'utf8');
    const direct = parseStructureFile(content, f).structure;
    if (direct.species.length === 0) fail(`${f}: parseStructureFile broken`);
  }
  pass(`existing parsers untouched: parseStructureFile works for nacl/silicon/tio2-rutile/graphene`);
}

// ---- Test 5: invariants — frame[0] valid, latticeMode known value ----
{
  const p = path.join(ROOT, 'test/fixtures/test-magmom.poscar');
  const content = fs.readFileSync(p, 'utf8');
  const traj = parseStructureFileTraj(content, 'test-magmom.poscar').trajectory;
  if (traj.frames.length < 1) fail('invariant: frames.length must be >= 1');
  if (traj.latticeMode !== 'fixed' && traj.latticeMode !== 'per-frame') {
    fail(`invariant: latticeMode must be 'fixed' or 'per-frame', got '${traj.latticeMode}'`);
  }
  if (traj.frames[0].positions.length !== traj.frames[0].species.length) {
    fail(`invariant: positions/species length mismatch`);
  }
  // Optional fields preserved on frame 0
  // v0.18.1: moments live in `atomVectors` (kind 'magmom').
  const av = traj.frames[0].atomVectors;
  if (!av || av.kind !== 'magmom' || av.values.length !== traj.frames[0].species.length) {
    fail(`magmom atomVectors not preserved through trajectory wrap: ${JSON.stringify(av && { kind: av.kind, n: av.values.length })}`);
  }
  pass(`invariants verified: frames>=1, latticeMode valid, positions/species aligned, magmom atomVectors preserved`);
}

console.log('\nAll trajectory-bridge tests passed.');
