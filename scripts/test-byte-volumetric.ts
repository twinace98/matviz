/**
 * v0.22 Tier 2 equivalence test. Loads each volumetric fixture through
 * both the string path (`parseStructureFileTraj`) and the byte path
 * (`parseStructureFileTrajFromBytes`) and asserts that the resulting
 * volumetric grids match bit-for-bit (Float32 representation), and that
 * structure metadata (lattice, species, positions, dims) agrees.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { parseStructureFileTraj, parseStructureFileTrajFromBytes } from '../src/parsers/index';
import { tentDownsample } from '../src/parsers/downsample';

const FIXTURES = [
  'test/fixtures/h2o.cube',
  'test/fixtures/LiF-polaron-isolevel.xsf',
];

function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= eps + eps * Math.max(Math.abs(a), Math.abs(b));
}

let failures = 0;

for (const fixture of FIXTURES) {
  const filename = path.basename(fixture);
  const bytes = readFileSync(fixture);
  const text = bytes.toString('utf8');

  const strRes = parseStructureFileTraj(text, filename);
  const byteRes = parseStructureFileTrajFromBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), filename);

  const strF0 = strRes.trajectory.frames[0];
  const byteF0 = byteRes.trajectory.frames[0];

  const checks: Array<[string, boolean]> = [
    ['species length', strF0.species.length === byteF0.species.length],
    ['species symbols', strF0.species.every((s, i) => s === byteF0.species[i])],
    ['lattice agrees', strF0.lattice.every((v, i) =>
      v.every((c, j) => approxEqual(c, byteF0.lattice[i][j])))],
    ['positions agree', strF0.positions.every((p, i) =>
      p.every((c, j) => approxEqual(c, byteF0.positions[i][j])))],
    ['volumetric presence', !!strRes.volumetric === !!byteRes.volumetric],
  ];

  if (strRes.volumetric && byteRes.volumetric) {
    const a = strRes.volumetric;
    const b = byteRes.volumetric;
    checks.push(['dims', a.dims.every((d, i) => d === b.dims[i])]);
    checks.push(['origin', a.origin.every((o, i) => approxEqual(o, b.origin[i]))]);
    checks.push(['volumetric lattice', a.lattice.every((v, i) =>
      v.every((c, j) => approxEqual(c, b.lattice[i][j])))]);
    checks.push(['data length', a.data.length === b.data.length]);

    let dataAgrees = true;
    let firstDiffIdx = -1;
    const N = Math.min(a.data.length, b.data.length);
    for (let i = 0; i < N; i++) {
      if (a.data[i] !== b.data[i]) {
        dataAgrees = false;
        firstDiffIdx = i;
        break;
      }
    }
    checks.push([
      dataAgrees ? 'data bit-equal' : `data diverges at idx ${firstDiffIdx} (str=${a.data[firstDiffIdx]}, byte=${b.data[firstDiffIdx]})`,
      dataAgrees,
    ]);
  }

  console.log(`\n[${filename}]`);
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok) failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll byte-path checks passed.');

// --- v0.22 Tier 3 stride verification ------------------------------------
// Force a stride > 1 on the LiF polaron XSF by setting a tiny cap, then
// verify the decimated grid matches the expected sub-sample of the full
// grid (computed via the string path).

const xsfBytes = readFileSync('test/fixtures/LiF-polaron-isolevel.xsf');
const xsfText = xsfBytes.toString('utf8');
const fullStr = parseStructureFileTraj(xsfText, 'LiF-polaron-isolevel.xsf');
if (!fullStr.volumetric) throw new Error('expected volumetric in LiF fixture');
const [nx, ny, nz] = fullStr.volumetric.dims;
const fullData = fullStr.volumetric.data;

// Cap at 1e5 → must force stride > 1 on a ~5e4-point grid (e.g., 30^3, 50^3).
// LiF-polaron is around 60^3 = 2.16e5, so stride 2 should be selected.
const CAP = 1e4;
const decimated = parseStructureFileTrajFromBytes(
  new Uint8Array(xsfBytes.buffer, xsfBytes.byteOffset, xsfBytes.byteLength),
  'LiF-polaron-isolevel.xsf',
  { maxGridPoints: CAP },
);
const dvol = decimated.volumetric;
if (!dvol) throw new Error('decimated volumetric missing');
const stride = dvol.stride ?? 1;
const [onx, ony, onz] = dvol.dims;

console.log(`\n[LiF decimated cap=${CAP}]`);
console.log(`  source dims:  ${nx}×${ny}×${nz}  (${nx*ny*nz} points)`);
console.log(`  output dims:  ${onx}×${ony}×${onz}  (${onx*ony*onz} points)`);
console.log(`  stride:       ${stride}`);
console.log(`  originalDims: ${dvol.originalDims?.join('×')}`);

// v0.23.1: decimation is a tent splat (src/parsers/downsample.ts), not
// stride sampling. Reference = the in-memory tent downsample of the full
// grid. The byte path accumulates in file order (x fastest), the reference in
// C order, so values agree to float rounding, not bit-for-bit.
const ref = tentDownsample(fullData, [nx, ny, nz], [onx, ony, onz]);
let maxAbs = 0, maxDiff = 0;
for (let i = 0; i < ref.length; i++) {
  maxAbs = Math.max(maxAbs, Math.abs(ref[i]));
  maxDiff = Math.max(maxDiff, Math.abs(ref[i] - dvol.data[i]));
}
const strideOk = ref.length === dvol.data.length && maxDiff <= 1e-6 * (maxAbs || 1);
console.log(`  ${strideOk ? 'OK  ' : 'FAIL'} decimated grid matches tent downsample of the full grid (max rel diff ${(maxDiff / (maxAbs || 1)).toExponential(1)})`);
if (!strideOk) process.exit(1);
console.log('\nAll stride checks passed.');

// --- v0.22 Tier 3 string-path decimation -----------------------------------
// User-set `maxGridPoints` must also decimate when the file is loaded via
// the small-file string path. Without this, the setting would be invisible
// to users with sub-256-MiB files and the info-pill stride indicator would
// never appear in routine workflows.

const lifStrCap = parseStructureFileTraj(xsfText, 'LiF-polaron-isolevel.xsf', { maxGridPoints: CAP });
if (!lifStrCap.volumetric) throw new Error('expected volumetric');
const stringStride = lifStrCap.volumetric.stride ?? 1;
const [snx, sny, snz] = lifStrCap.volumetric.dims;

console.log(`\n[LiF string path with cap=${CAP}]`);
console.log(`  output dims:  ${snx}×${sny}×${snz}`);
console.log(`  stride:       ${stringStride}`);
console.log(`  originalDims: ${lifStrCap.volumetric.originalDims?.join('×')}`);

const stringPathOk =
  stringStride === stride &&
  snx === onx && sny === ony && snz === onz;
console.log(`  ${stringPathOk ? 'OK  ' : 'FAIL'} string-path decimation matches byte-path stride/dims`);
if (!stringPathOk) {
  process.exit(1);
}

// And: the string-path values match the byte-path values (same tent splat,
// different accumulation order → float-rounding agreement).
let crossDiff = 0, crossMax = 0;
for (let i = 0; i < lifStrCap.volumetric.data.length; i++) {
  crossMax = Math.max(crossMax, Math.abs(dvol.data[i]));
  crossDiff = Math.max(crossDiff, Math.abs(lifStrCap.volumetric.data[i] - dvol.data[i]));
}
const crossEqual = crossDiff <= 1e-6 * (crossMax || 1);
console.log(`  ${crossEqual ? 'OK  ' : 'FAIL'} string-path decimated values match byte-path (max rel diff ${(crossDiff / (crossMax || 1)).toExponential(1)})`);
if (!crossEqual) process.exit(1);

console.log('\nAll string-path decimation checks passed.');
