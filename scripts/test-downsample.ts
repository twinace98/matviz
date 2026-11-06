/**
 * v0.23.1 Feature 23.1.4 — tent downsampling tests.
 *
 * Unit: identity at factor 1, constant field preserved, mean preserved,
 * centroid drift ≤ 0.10 output voxel for N ∈ {100, 101, 64, 41} × s ∈ {2, 3},
 * skipLast ≡ trimmed grid.
 * Parser: byte-path (cube / XSF / CHGCAR) and string-path downsampling of the
 * real fixtures keep the |ρ|-weighted centroid within 0.10 output voxel of
 * the full-resolution grid; byte and string paths agree.
 *
 * Build: esbuild.mjs → dist/test-downsample.js. Run: node dist/test-downsample.js
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { makeAxisMap, tentDownsample, TentAccumulator, detectRedundantEndpoints } from '../src/parsers/downsample';
import { parseStructureFileTraj, parseStructureFileTrajFromBytes } from '../src/parsers/index';
import type { VolumetricData } from '../src/parsers/types';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

type Dims = [number, number, number];

/** Periodic Gaussian blob (C order, z fastest), centered off-grid at `c` (fractional). */
function blob(dims: Dims, c: Dims, sigma = 0.08): Float32Array {
  const [nx, ny, nz] = dims;
  const d = new Float32Array(nx * ny * nz);
  const pd = (f: number, c0: number) => { let x = f - c0; x -= Math.round(x); return x; };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const x = pd(i / nx, c[0]), y = pd(j / ny, c[1]), z = pd(k / nz, c[2]);
    d[i * ny * nz + j * nz + k] = Math.exp(-(x * x + y * y + z * z) / (2 * sigma * sigma));
  }
  return d;
}

/**
 * |v|-weighted *circular* centroid in fractional coordinates (renderer
 * convention f = i / n). Periodic grids need the circular mean: density that
 * straddles the cell boundary has no meaningful linear centroid.
 */
function centroidFrac(data: ArrayLike<number>, dims: Dims): Dims {
  const [nx, ny, nz] = dims;
  const sc = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const v = Math.abs(data[i * ny * nz + j * nz + k]);
    const f = [i / nx, j / ny, k / nz];
    for (let a = 0; a < 3; a++) {
      sc[2 * a] += v * Math.sin(2 * Math.PI * f[a]);
      sc[2 * a + 1] += v * Math.cos(2 * Math.PI * f[a]);
    }
  }
  return [0, 1, 2].map(a => Math.atan2(sc[2 * a], sc[2 * a + 1]) / (2 * Math.PI)) as Dims;
}
/** Periodic fractional difference in (−0.5, 0.5]. */
const pdiff = (a: number, b: number) => { const d = a - b; return d - Math.round(d); };

function mean(a: ArrayLike<number>) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

// ---------------------------------------------------------------------------
console.log('[unit] axis map');
{
  const m = makeAxisMap(10, 10);
  let ok = true;
  for (let i = 0; i < 10; i++) ok &&= m.j0[i] === i && m.w0[i] === 1 && m.w1[i] === 0;
  check('M = N is an exact identity map', ok);
  const k = makeAxisMap(41, 20, true);
  check('skipLast: last sample has zero weight', k.w0[40] === 0 && k.w1[40] === 0);
  const tot = Array.from(makeAxisMap(101, 34).wsum).reduce((a, b) => a + b, 0);
  check('weights sum to N', Math.abs(tot - 101) < 1e-9, `(${tot})`);
}

console.log('[unit] identity / constant / mean / centroid');
{
  const dims: Dims = [17, 13, 11];
  const d = blob(dims, [0.3, 0.6, 0.45]);
  const same = tentDownsample(d, dims, dims);
  check('factor 1 is bit-identical', same.every((v, i) => v === d[i]));

  for (const N of [100, 101, 64, 41]) {
    for (const s of [2, 3]) {
      const dims3: Dims = [N, N, N];
      const out: Dims = [Math.ceil(N / s), Math.ceil(N / s), Math.ceil(N / s)];
      const c = new Float32Array(N * N * N).fill(2.5);
      const cd = tentDownsample(c, dims3, out);
      let maxErr = 0; for (const v of cd) maxErr = Math.max(maxErr, Math.abs(v - 2.5));
      const b = blob(dims3, [0.37, 0.52, 0.61]);
      const bd = tentDownsample(b, dims3, out);
      const c0 = centroidFrac(b, dims3), c1 = centroidFrac(bd, out);
      const drift = Math.max(...[0, 1, 2].map(a => Math.abs(pdiff(c1[a], c0[a])) * out[a]));
      const relMean = Math.abs(mean(bd) - mean(b)) / mean(b);
      // Mean: exact only when M divides N (uniform node weights); for the
      // barely-resolved σ = 0.08 blob at M = 14 it stays ≲ 2e-3.
      check(`N=${N} s=${s}: constant kept, mean & centroid preserved`,
        maxErr < 1e-5 && relMean < 5e-3 && drift <= 0.10,
        `const err ${maxErr.toExponential(1)}, mean rel ${relMean.toExponential(1)}, drift ${drift.toFixed(3)} vox`);
    }
  }
}

console.log('[unit] skipLast ≡ trimmed grid');
{
  // 41 samples per axis with a periodic closure plane == 40-sample periodic grid.
  const N = 40, dimsT: Dims = [N, N, N];
  const t = blob(dimsT, [0.2, 0.7, 0.5]);
  const dimsF: Dims = [N + 1, N + 1, N + 1];
  const f = new Float32Array((N + 1) ** 3);
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (let k = 0; k <= N; k++)
    f[i * (N + 1) ** 2 + j * (N + 1) + k] = t[(i % N) * N * N + (j % N) * N + (k % N)];
  const out: Dims = [14, 14, 14];
  const a = tentDownsample(t, dimsT, out);
  const b = tentDownsample(f, dimsF, out, [true, true, true]);
  let maxDiff = 0; for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  check('closure-plane grid with skipLast matches trimmed grid', maxDiff < 1e-6, `max diff ${maxDiff.toExponential(1)}`);

  // Detection works on XSF file order (x fastest).
  const plane = (z: number) => { const p = new Float64Array((N + 1) ** 2); for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) p[x + (N + 1) * y] = f[x * (N + 1) ** 2 + y * (N + 1) + z]; return p; };
  const det = detectRedundantEndpoints(dimsF, plane(0), plane(N));
  check('detectRedundantEndpoints finds all three closure planes', det.every(Boolean), JSON.stringify(det));
  const det2 = detectRedundantEndpoints(dimsT, plane(0).subarray(0, 0), plane(0).subarray(0, 0));
  check('detectRedundantEndpoints tolerates empty planes', Array.isArray(det2));
}

console.log('[unit] x-fastest stream order == z-fastest');
{
  const dims: Dims = [9, 7, 5];
  const d = blob(dims, [0.4, 0.4, 0.4]);
  const out: Dims = [4, 3, 2];
  const ref = tentDownsample(d, dims, out);
  const acc = new TentAccumulator(dims, out, { order: 'x-fastest' });
  for (let z = 0; z < 5; z++) for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) acc.push(d[x * 35 + y * 5 + z]);
  const got = acc.finish();
  let maxDiff = 0; for (let i = 0; i < ref.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ref[i] - got[i]));
  check('same result regardless of source order', acc.complete && maxDiff < 1e-6, `max diff ${maxDiff.toExponential(1)}`);
}

// ---------------------------------------------------------------------------
console.log('[parser] fixtures through byte + string paths');
const root = path.resolve(__dirname, '..');
const FIX = [
  'test/fixtures/h2o.cube',
  'test/fixtures/LiF-polaron-isolevel.xsf',
  'test/fixtures/band15_Gamma.xsf',
  'test/fixtures/xsf-two-datagrid.xsf',
  'test/fixtures/chgcar-collinear-spin',
  'test/fixtures/chgcar-soc-noncollinear',
];
// CHGCAR fixtures are not named CHGCAR on disk; the parser dispatches by name.
const parseName = (file: string) => (path.basename(file).startsWith('chgcar') ? 'CHGCAR' : path.basename(file));
for (const rel of FIX) {
  const file = path.join(root, rel);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(readFileSync(file)); } catch { console.log(`  skip ${rel} (missing)`); continue; }
  const name = parseName(file);
  const full = parseStructureFileTrajFromBytes(bytes, name).volumetrics ?? [];
  if (full.length === 0) { check(`${rel}: has grids`, false); continue; }
  const g0 = full[0];
  if (Math.min(...g0.dims) < 8) { console.log(`  skip ${rel} (grid ${g0.dims.join('×')} too small to downsample)`); continue; }
  for (const s of [2, 3]) {
    const cap = g0.dims.reduce((p, n) => p * Math.ceil(n / s), 1);
    const byte = parseStructureFileTrajFromBytes(bytes, name, { maxGridPoints: cap }).volumetrics!;
    const str = parseStructureFileTraj(new TextDecoder().decode(bytes), name, { maxGridPoints: cap }).volumetrics!;
    for (let gi = 0; gi < full.length; gi++) {
      const F: VolumetricData = full[gi], B = byte[gi], S = str[gi];
      if (!B) { check(`${rel}[${gi}] s=${s}: byte grid present`, false); continue; }
      const cF = centroidFrac(F.data, F.dims), cB = centroidFrac(B.data, B.dims);
      const drift = Math.max(...[0, 1, 2].map(a => Math.abs(pdiff(cB[a], cF[a])) * B.dims[a]));
      let agree = '';
      let ok = drift <= 0.10;
      if (S && S.data.length === B.data.length) {
        let m = 0, mx = 0;
        for (let i = 0; i < S.data.length; i++) { m = Math.max(m, Math.abs(S.data[i] - B.data[i])); mx = Math.max(mx, Math.abs(B.data[i])); }
        const rel_ = m / (mx || 1);
        agree = `, byte≡string ${rel_.toExponential(1)}`;
        ok &&= rel_ < 1e-5;
      } else if (S) {
        // String path may only decimate the primary grid (v0.22 behavior).
        agree = gi === 0 ? `, string dims ${S.dims.join('×')} ≠ byte` : '';
        if (gi === 0) ok = false;
      }
      check(`${path.basename(path.dirname(rel)) === 'fixtures' ? name : rel}[${F.name ?? gi}] s=${s} ${F.dims.join('×')}→${B.dims.join('×')}`,
        ok, `drift ${drift.toFixed(3)} vox${agree}`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('[parser] byte path keeps every named grid');
for (const [rel, as] of [['test/fixtures/xsf-two-datagrid.xsf', 'x.xsf'], ['test/fixtures/chgcar-collinear-spin', 'CHGCAR'], ['test/fixtures/chgcar-soc-noncollinear', 'CHGCAR']]) {
  const b = readFileSync(path.join(root, rel));
  const str = (parseStructureFileTraj(b.toString('utf8'), as).volumetrics ?? []).map(g => g.name).join(',');
  const byt = (parseStructureFileTrajFromBytes(new Uint8Array(b), as).volumetrics ?? []).map(g => g.name).join(',');
  check(`${path.basename(rel)}: byte grids == string grids`, str === byt && str.includes(','), `[${byt}]`);
}

console.log('[parser] synthetic large grids (odd N, closure planes, spin CHGCAR)');
{
  const fmt = (v: number) => v.toExponential(6);
  /** Periodic blob value at fractional (fx, fy, fz). */
  const val = (fx: number, fy: number, fz: number, c: Dims, sign = 1) => {
    const pd = (f: number, c0: number) => { let x = f - c0; x -= Math.round(x); return x; };
    const x = pd(fx, c[0]), y = pd(fy, c[1]), z = pd(fz, c[2]);
    return sign * Math.exp(-(x * x + y * y + z * z) / (2 * 0.1 * 0.1));
  };
  const L = 10;
  const cases: Array<{ name: string; parseAs: string; text: string }> = [];

  // Cube, N = 33 (odd; not divisible by 2 or 3). z fastest, 6 per line.
  {
    const N = 33, h = L / N / 0.529177249, vals: string[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++)
      vals.push(fmt(val(i / N, j / N, k / N, [0.31, 0.58, 0.77])));
    const rows: string[] = []; for (let i = 0; i < vals.length; i += 6) rows.push(vals.slice(i, i + 6).join(' '));
    cases.push({ name: 'cube 33³', parseAs: 'synthetic.cube', text:
      `gen\nblob\n1 0 0 0\n${N} ${h} 0 0\n${N} 0 ${h} 0\n${N} 0 0 ${h}\n8 8.0 1 1 1\n${rows.join('\n')}\n` });
  }
  // XSF general grid, 31 points per axis incl. periodic closure (period 30).
  {
    const N = 31, P = 30, vals: string[] = [];
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
      vals.push(fmt(val((i % P) / P, (j % P) / P, (k % P) / P, [0.12, 0.47, 0.93])));
    const rows: string[] = []; for (let i = 0; i < vals.length; i += 6) rows.push(vals.slice(i, i + 6).join(' '));
    cases.push({ name: 'xsf 31³ general grid', parseAs: 'synthetic.xsf', text:
      `CRYSTAL\nPRIMVEC\n${L} 0 0\n0 ${L} 0\n0 0 ${L}\nPRIMCOORD\n1 1\nO 1 1 1\n` +
      `BEGIN_BLOCK_DATAGRID_3D\nblob\nBEGIN_DATAGRID_3D_psi\n${N} ${N} ${N}\n0 0 0\n${L} 0 0\n0 ${L} 0\n0 0 ${L}\n` +
      `${rows.join('\n')}\nEND_DATAGRID_3D\nEND_BLOCK_DATAGRID_3D\n` });
  }
  // CHGCAR, ISPIN = 2, N = 29 (prime). x fastest, 5 per line; second block signed.
  {
    const N = 29;
    const block = (sign: number, c: Dims) => {
      const vals: string[] = [];
      for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
        vals.push(fmt(val(i / N, j / N, k / N, c, sign)));
      const rows: string[] = []; for (let i = 0; i < vals.length; i += 5) rows.push(vals.slice(i, i + 5).join(' '));
      return rows.join('\n');
    };
    cases.push({ name: 'CHGCAR 29³ spin', parseAs: 'CHGCAR', text:
      `synthetic\n1.0\n${L} 0 0\n0 ${L} 0\n0 0 ${L}\nFe\n1\nDirect\n0 0 0\n\n` +
      `${N} ${N} ${N}\n${block(1, [0.25, 0.25, 0.6])}\naugmentation occupancies 1 1\n0.1\n` +
      `${N} ${N} ${N}\n${block(-1, [0.7, 0.4, 0.2])}\naugmentation occupancies 1 1\n0.0\n` });
  }

  for (const c of cases) {
    const bytes = new TextEncoder().encode(c.text);
    const full = parseStructureFileTrajFromBytes(bytes, c.parseAs).volumetrics!;
    for (const s of [2, 3]) {
      const cap = full[0].dims.reduce((p, n) => p * Math.ceil(n / s), 1);
      const byte = parseStructureFileTrajFromBytes(bytes, c.parseAs, { maxGridPoints: cap }).volumetrics!;
      const str = parseStructureFileTraj(c.text, c.parseAs, { maxGridPoints: cap }).volumetrics!;
      for (let gi = 0; gi < full.length; gi++) {
        const F = full[gi], B = byte[gi], S = str[gi];
        const cF = centroidFrac(F.data, F.dims), cB = centroidFrac(B.data, B.dims);
        const drift = Math.max(...[0, 1, 2].map(a => Math.abs(pdiff(cB[a], cF[a])) * B.dims[a]));
        let m = 0, mx = 0;
        const same = S.data.length === B.data.length;
        if (same) for (let i = 0; i < S.data.length; i++) { m = Math.max(m, Math.abs(S.data[i] - B.data[i])); mx = Math.max(mx, Math.abs(B.data[i])); }
        // Normalize by mean |F|: signed grids (magnetization, spin_up of a
        // synthetic with opposite lobes) can have a mean near zero.
        let absMean = 0; for (let i = 0; i < F.data.length; i++) absMean += Math.abs(F.data[i]);
        absMean /= F.data.length;
        const relMean = Math.abs(mean(B.data) - mean(F.data)) / (absMean || 1);
        check(`${c.name}[${F.name}] s=${s} ${F.dims.join('×')}→${B.dims.join('×')}`,
          drift <= 0.10 && same && m / (mx || 1) < 1e-5 && relMean < 5e-3,
          `drift ${drift.toFixed(3)} vox, mean rel ${relMean.toExponential(1)}, byte≡string ${same ? (m / (mx || 1)).toExponential(1) : 'dims differ'}`);
      }
    }
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
