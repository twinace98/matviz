/**
 * One-shot verification for v0.16.1 (1/3) — CIF aniso parser + multi-loop
 * refactor + degenerate-cell NaN guards.
 *
 * Asserts that test/fixtures/test-aniso.cif yields the expected
 * thermalAniso array and that nacl.cif (no aniso) leaves thermalAniso
 * undefined. Also checks that a synthetic degenerate cell throws.
 *
 * Run via: node dist/test-aniso.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseCif } from '../src/parsers/cifParser';

const ROOT = process.cwd();

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

// ---- Test 1: aniso CIF round-trip ----
{
  const cifPath = path.join(ROOT, 'test/fixtures/test-aniso.cif');
  const content = fs.readFileSync(cifPath, 'utf8');
  const s = parseCif(content);

  if (s.species.length !== 2) fail(`expected 2 atoms, got ${s.species.length}: ${s.species.join(',')}`);
  if (s.species[0] !== 'Ca' || s.species[1] !== 'O') fail(`species mismatch: ${s.species.join(',')}`);
  if (!s.thermalAniso) fail('thermalAniso missing');
  if (s.thermalAniso.length !== 2) fail(`thermalAniso length ${s.thermalAniso.length} != 2`);

  const ca = s.thermalAniso[0];
  if (!ca) fail('thermalAniso[0] (Ca) is null');
  if (!approx(ca.U11, 0.012) || !approx(ca.U22, 0.012) || !approx(ca.U33, 0.030)) {
    fail(`Ca diagonal U mismatch: U11=${ca.U11} U22=${ca.U22} U33=${ca.U33}`);
  }
  if (!approx(ca.U12, 0) || !approx(ca.U13, 0) || !approx(ca.U23, 0)) {
    fail(`Ca off-diagonal U should be zero: U12=${ca.U12} U13=${ca.U13} U23=${ca.U23}`);
  }

  const o = s.thermalAniso[1];
  if (!o) fail('thermalAniso[1] (O) is null');
  if (!approx(o.U11, 0.020) || !approx(o.U23, 0.003)) {
    fail(`O U mismatch: U11=${o.U11} U23=${o.U23}`);
  }
  if (!approx(o.U13, -0.002)) {
    fail(`O U13 sign mismatch: expected -0.002, got ${o.U13}`);
  }
  pass('test-aniso.cif: 2 atoms + thermalAniso parsed correctly (U-form, off-diagonal preserved)');
}

// ---- Test 2: existing fixture (no aniso) leaves thermalAniso undefined ----
{
  const cifPath = path.join(ROOT, 'test/fixtures/nacl.cif');
  const content = fs.readFileSync(cifPath, 'utf8');
  const s = parseCif(content);

  if (s.thermalAniso !== undefined) {
    fail(`nacl.cif: thermalAniso should be undefined, got ${JSON.stringify(s.thermalAniso)}`);
  }
  if (s.species.length === 0) fail(`nacl.cif: no atoms parsed (regression in multi-loop refactor)`);
  pass(`nacl.cif: thermalAniso undefined; ${s.species.length} atoms (no parser regression)`);
}

// ---- Test 3: degenerate-cell guard ----
{
  const degenCif = `data_degen
_cell_length_a 4.0
_cell_length_b 4.0
_cell_length_c 4.0
_cell_angle_alpha 90.0
_cell_angle_beta  90.0
_cell_angle_gamma 0.0

loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
A 0 0 0
`;
  let threw = false;
  try {
    parseCif(degenCif);
  } catch (e) {
    threw = true;
    if (!(e as Error).message.includes('Degenerate')) {
      fail(`degenerate guard threw wrong error: ${(e as Error).message}`);
    }
  }
  if (!threw) fail('degenerate cell (γ=0) did not throw');
  pass('degenerate cell (γ=0°): NaN guard fires correctly');
}

// ---- Test 4: existing complex fixture (perovskite via tio2-rutile) ----
{
  const cifPath = path.join(ROOT, 'test/fixtures/tio2-rutile.cif');
  const content = fs.readFileSync(cifPath, 'utf8');
  const s = parseCif(content);
  if (s.species.length === 0) fail('tio2-rutile.cif: no atoms (parser regression)');
  pass(`tio2-rutile.cif: ${s.species.length} atoms after symmetry expansion (regression-free)`);
}

console.log('\nAll v0.16.1 (1/3) parser tests passed.');
