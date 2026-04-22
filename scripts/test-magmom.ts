/**
 * Verification for v0.16.3 — magnetic moment parsing.
 *
 * Asserts:
 *   1. POSCAR with MAGMOM in title: collinear N-token form → [0,0,m] per atom
 *   2. POSCAR without MAGMOM: magMom undefined
 *   3. POSCAR with mismatched token count: magMom undefined (silent)
 *   4. POSCAR with non-collinear 3N tokens: per-atom 3-vector
 *   5. parseMagmomFromTitle() compressed form rejected (k*v not supported)
 *
 * Run via: node dist/test-magmom.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { parsePoscar, parseMagmomFromTitle } from '../src/parsers/poscarParser';

const ROOT = process.cwd();

function approx(a: number, b: number, tol = 1e-6): boolean { return Math.abs(a - b) < tol; }
function fail(msg: string): never { console.error(`✗ FAIL: ${msg}`); process.exit(1); }
function pass(msg: string): void { console.log(`✓ ${msg}`); }

// ---- Test 1: NiO AFM POSCAR with collinear MAGMOM ----
{
  const p = path.join(ROOT, 'test/fixtures/test-magmom.poscar');
  const s = parsePoscar(fs.readFileSync(p, 'utf8'));
  if (s.species.length !== 4) fail(`expected 4 atoms, got ${s.species.length}`);
  if (!s.magMom) fail('magMom missing');
  if (s.magMom.length !== 4) fail(`magMom length ${s.magMom.length} != 4`);
  // Ni up, Ni down, O zero, O zero
  if (!approx(s.magMom[0][2], 2.0) || !approx(s.magMom[1][2], -2.0)) {
    fail(`Ni moments z mismatch: ${s.magMom[0][2]}, ${s.magMom[1][2]}`);
  }
  if (!approx(s.magMom[2][2], 0) || !approx(s.magMom[3][2], 0)) {
    fail(`O moments z mismatch: ${s.magMom[2][2]}, ${s.magMom[3][2]}`);
  }
  if (s.magMom[0][0] !== 0 || s.magMom[0][1] !== 0) {
    fail(`Ni moment x/y should be 0 in collinear, got [${s.magMom[0].join(',')}]`);
  }
  pass('NiO AFM POSCAR: collinear MAGMOM parsed → [0,0,±2] for Ni, [0,0,0] for O');
}

// ---- Test 2: silicon.poscar (no MAGMOM) ----
{
  const p = path.join(ROOT, 'test/fixtures/silicon.poscar');
  const s = parsePoscar(fs.readFileSync(p, 'utf8'));
  if (s.magMom !== undefined) fail(`silicon.poscar: magMom should be undefined, got ${JSON.stringify(s.magMom)}`);
  pass('silicon.poscar: magMom field omitted (no MAGMOM tag)');
}

// ---- Test 3: Mismatched token count silently ignored ----
{
  // 4 atoms but 3 tokens — neither collinear (4) nor non-collinear (12)
  const result = parseMagmomFromTitle('Bad MAGMOM = 1 2 3', 4);
  if (result !== null) fail(`mismatched count should return null, got ${JSON.stringify(result)}`);
  pass('parseMagmomFromTitle: mismatched token count returns null silently');
}

// ---- Test 4: Non-collinear 3N form ----
{
  // 2 atoms, 6 tokens (3-vector per atom)
  const result = parseMagmomFromTitle('foo MAGMOM = 1 0 0 0 0 -1.5', 2);
  if (!result) fail('non-collinear should parse');
  if (result.length !== 2) fail(`length ${result.length} != 2`);
  if (!approx(result[0][0], 1) || !approx(result[0][1], 0) || !approx(result[0][2], 0)) {
    fail(`atom 0: ${result[0]}`);
  }
  if (!approx(result[1][2], -1.5)) {
    fail(`atom 1 z: ${result[1][2]}`);
  }
  pass('parseMagmomFromTitle: non-collinear 3N form yields per-atom 3-vector');
}

// ---- Test 5: Compressed form (k*v) rejected ----
{
  const result = parseMagmomFromTitle('MAGMOM = 4*1.0', 4);
  if (result !== null) fail(`compressed form should be rejected, got ${JSON.stringify(result)}`);
  pass('parseMagmomFromTitle: compressed form (k*v) rejected as documented');
}

// ---- Test 6: silicon.poscar regression — atoms still parsed ----
{
  const p = path.join(ROOT, 'test/fixtures/silicon.poscar');
  const s = parsePoscar(fs.readFileSync(p, 'utf8'));
  if (s.species.length === 0) fail('silicon.poscar: no atoms parsed (regression in MAGMOM extension)');
  pass(`silicon.poscar: ${s.species.length} atoms (no parser regression)`);
}

console.log('\nAll v0.16.3 magmom tests passed.');
