/**
 * v0.23.1 Feature 23.1.3 — streaming volumetric parser tests.
 *
 *   node dist/test-volumetric-stream.js           # routine (seconds)
 *   node dist/test-volumetric-stream.js --large   # + > 2 GiB real file (minutes, ~2.3 GB temp disk)
 *
 * - parseNumberToken ≡ parseFloat (bit-for-bit) on edge cases + 200k random tokens
 * - factor 1: stream ≡ string path, bit-for-bit (all grids, names, structure)
 * - factor 2/3: stream ≡ byte path (same resampler, same dims)
 * - chunk sizes 7 B / 1 KiB / 4 MiB give identical output
 * - progress reaches the file size; abort rejects with AbortError
 * - --large: a > 2 GiB cube that fs.readFile refuses streams at factor 2 with
 *   peak RSS growth ≲ the output grid
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseVolumetricStream, parseNumberToken } from '../src/parsers/volumetricStream';
import { parseStructureFileTraj, parseStructureFileTrajFromBytes } from '../src/parsers/index';
import type { VolumetricData } from '../src/parsers/types';
import { synthCube, synthXsf, synthChgcar } from './lib/synthGrids';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matviz-stream-'));

function sameGrids(a: VolumetricData[], b: VolumetricData[], tol: number): string | null {
  if (a.length !== b.length) return `grid count ${a.length} vs ${b.length}`;
  for (let g = 0; g < a.length; g++) {
    const x = a[g], y = b[g];
    if ((x.name ?? '') !== (y.name ?? '')) return `name ${x.name} vs ${y.name}`;
    if (x.dims.join() !== y.dims.join()) return `[${x.name}] dims ${x.dims} vs ${y.dims}`;
    if (JSON.stringify(x.lattice) !== JSON.stringify(y.lattice) || x.origin.join() !== y.origin.join()) return `[${x.name}] geometry differs`;
    if ((x.stride ?? 1) !== (y.stride ?? 1)) return `[${x.name}] stride ${x.stride} vs ${y.stride}`;
    let mx = 0, d = 0;
    for (let i = 0; i < x.data.length; i++) {
      mx = Math.max(mx, Math.abs(y.data[i]));
      if (tol === 0) { if (!Object.is(x.data[i], y.data[i])) return `[${x.name}] data[${i}] ${x.data[i]} vs ${y.data[i]}`; }
      else d = Math.max(d, Math.abs(x.data[i] - y.data[i]));
    }
    if (tol > 0 && d > tol * (mx || 1)) return `[${x.name}] max rel diff ${(d / (mx || 1)).toExponential(1)}`;
  }
  return null;
}

/** --child <file>: parse at factor 2 in a clean process and report peak RSS. */
async function child(file: string) {
  const hwm = () => Number(/VmHWM:\s+(\d+) kB/.exec(fs.readFileSync('/proc/self/status', 'utf8'))![1]) * 1024;
  const base = hwm();
  const t = Date.now();
  const r = await parseVolumetricStream(file, path.basename(file), { factor: 2 });
  const secs = (Date.now() - t) / 1000;
  const g = r.volumetrics![0];
  let mx = -Infinity, at = 0; g.data.forEach((v, i) => { if (v > mx) { mx = v; at = i; } });
  const [nx, ny, nz] = g.dims;
  const peakAt = [Math.floor(at / (ny * nz)) / nx, (Math.floor(at / nz) % ny) / ny, (at % nz) / nz];
  console.log(JSON.stringify({ base, peak: hwm(), secs, dims: g.dims.join(), stride: g.stride, outBytes: g.data.byteLength, peakVal: mx, peakAt }));
}

if (process.argv[2] === '--child') { child(process.argv[3]).catch(e => { console.error(e); process.exit(1); }); }
else (async () => {
  console.log('[number scanner]');
  {
    const edge = ['0', '-0', '0.0', '-0.000E+00', '1', '-1', '1.5', '.5', '-.5', '5.', '1e5', '1E-5', '1.234567E-03',
      '-2.345678e+12', '0.12345678901E+02', '123456789012345', '1234567890123456', '12345678901234567890',
      '1e-30', '9.9999999999999999E+307', '4.9406564584124654E-324', '1.7976931348623157e308', '1e400',
      '1.0D+00', '1.0d-3', 'NaN', 'Infinity', '-Infinity', '+3.25', '1e', '1e+', '--1', '1.2.3', '0x10', '007.50'];
    let bad = '';
    for (const t of edge) {
      const b = new TextEncoder().encode(t);
      const v = parseNumberToken(b, b.length), w = parseFloat(t);
      if (!Object.is(v, w)) { bad += ` ${t}→${v}≠${w}`; }
    }
    check('edge tokens identical to parseFloat', bad === '', bad);
    let mism = 0;
    for (let k = 0; k < 200000; k++) {
      const x = (Math.random() - 0.5) * 10 ** Math.floor(Math.random() * 40 - 25);
      const t = [x.toExponential(Math.floor(Math.random() * 16)), x.toFixed(Math.floor(Math.random() * 12)), String(x)][k % 3];
      const b = new TextEncoder().encode(t);
      if (!Object.is(parseNumberToken(b, b.length), parseFloat(t))) mism++;
    }
    check('200k random tokens identical to parseFloat', mism === 0, `${mism} mismatches`);
  }

  // Inputs: fixtures + synthetic files written to tmp.
  const inputs: Array<[string, string, string]> = [];  // label, path, parse-as name
  for (const [rel, as] of [
    ['test/fixtures/h2o.cube', 'h2o.cube'], ['test/fixtures/LiF-polaron-isolevel.xsf', 'LiF.xsf'],
    ['test/fixtures/band15_Gamma.xsf', 'band15.xsf'], ['test/fixtures/xsf-two-datagrid.xsf', 'two.xsf'],
    ['test/fixtures/chgcar-collinear-spin', 'CHGCAR'], ['test/fixtures/chgcar-soc-noncollinear', 'CHGCAR'],
  ]) inputs.push([path.basename(rel), path.join(root, rel), as]);
  for (const [label, as, text] of [
    ['synthetic cube 33³', 'a.cube', synthCube(33)], ['synthetic xsf 31³ closure', 'b.xsf', synthXsf(31, 1, true)],
    ['synthetic xsf 30³ no closure', 'c.xsf', synthXsf(30, 1, false)], ['synthetic xsf 31³ ×2', 'd.xsf', synthXsf(31, 2, true)],
    ['synthetic CHGCAR 29³ ISPIN=2', 'CHGCAR', synthChgcar(29, 2)], ['synthetic CHGCAR 29³ SOC', 'CHGCAR', synthChgcar(29, 4)],
  ] as const) {
    const dir = fs.mkdtempSync(path.join(tmp, 's-'));
    fs.writeFileSync(path.join(dir, as), text);
    inputs.push([label, path.join(dir, as), as]);
  }

  console.log('[factor 1: stream ≡ string path, bit-for-bit]');
  for (const [label, file, as] of inputs) {
    const str = parseStructureFileTraj(fs.readFileSync(file, 'utf8'), as);
    const st = await parseVolumetricStream(file, as, { factor: 1 });
    const diff = sameGrids(st.volumetrics ?? [], str.volumetrics ?? [], 0);
    const s0 = st.trajectory.frames[0], s1 = str.trajectory.frames[0];
    const structOk = JSON.stringify([s0.species, s0.positions, s0.lattice, s0.spaceGroup]) === JSON.stringify([s1.species, s1.positions, s1.lattice, s1.spaceGroup]);
    check(label, diff === null && structOk, diff ?? (structOk ? `${(st.volumetrics ?? []).map(g => `${g.name}:${g.dims.join('×')}`).join(', ')}` : 'structure differs'));
  }

  console.log('[factor 2/3: stream ≡ byte path]');
  for (const [label, file, as] of inputs) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const full = parseStructureFileTrajFromBytes(bytes, as).volumetrics![0];
    if (Math.min(...full.dims) < 8) continue;
    for (const f of [2, 3]) {
      const st = await parseVolumetricStream(file, as, { factor: f });
      const cap = st.volumetrics![0].dims.reduce((a, b) => a * b, 1);
      const bp = parseStructureFileTrajFromBytes(bytes, as, { maxGridPoints: cap });
      const diff = sameGrids(st.volumetrics!, bp.volumetrics!, 1e-6);
      check(`${label} factor ${f}`, diff === null, diff ?? st.volumetrics!.map(g => `${g.name}:${g.dims.join('×')}`).join(', '));
    }
  }

  console.log('[chunk boundaries, progress, abort]');
  {
    const [, file, as] = inputs.find(i => i[0] === 'synthetic xsf 31³ ×2')!;
    const ref = await parseVolumetricStream(file, as, { factor: 2 });
    for (const hw of [7, 1024]) {
      const r = await parseVolumetricStream(file, as, { factor: 2, highWaterMark: hw });
      check(`highWaterMark ${hw} B ≡ 4 MiB`, sameGrids(r.volumetrics!, ref.volumetrics!, 0) === null);
    }
    const [, cfile] = inputs.find(i => i[0] === 'synthetic CHGCAR 29³ ISPIN=2')!;
    const r1 = await parseVolumetricStream(cfile, 'CHGCAR', { factor: 1, highWaterMark: 13 });
    const r0 = await parseVolumetricStream(cfile, 'CHGCAR', { factor: 1 });
    check('CHGCAR highWaterMark 13 B ≡ 4 MiB', sameGrids(r1.volumetrics!, r0.volumetrics!, 0) === null);

    let last = 0, mono = true;
    const size = fs.statSync(file).size;
    await parseVolumetricStream(file, as, { highWaterMark: 4096, onProgress: (b, t) => { if (b < last || t !== size) mono = false; last = b; } });
    check('progress monotonic and ends at file size', mono && last === size, `${last}/${size}`);

    const ac = new AbortController();
    let name = '';
    try {
      await parseVolumetricStream(file, as, { highWaterMark: 4096, signal: ac.signal, onProgress: () => ac.abort() });
    } catch (e: any) { name = e.name; }
    check('abort rejects with AbortError', name === 'AbortError', name || 'resolved');
  }

  if (process.argv.includes('--large')) {
    console.log('[--large: > 2 GiB cube]');
    const N = 600;  // 600³ × ~11.3 B ≈ 2.4 GB
    const file = path.join(tmp, 'large.cube');
    const t0 = Date.now();
    const fd = fs.openSync(file, 'w');
    const h = 10 / N / 0.529177249;
    fs.writeSync(fd, `large\ncube\n1 0 0 0\n${N} ${h} 0 0\n${N} 0 ${h} 0\n${N} 0 0 ${h}\n8 8.0 1 1 1\n`);
    const row: string[] = [];
    for (let i = 0; i < N; i++) {
      let block = '';
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < N; k++) {
          const x = i / N - 0.4, y = j / N - 0.5, z = k / N - 0.6;
          row.push(Math.exp(-(x * x + y * y + z * z) / 0.02).toExponential(5));
          if (row.length === 6) { block += row.join(' ') + '\n'; row.length = 0; }
        }
      }
      fs.writeSync(fd, block);
    }
    if (row.length) fs.writeSync(fd, row.join(' ') + '\n');
    fs.closeSync(fd);
    const size = fs.statSync(file).size;
    console.log(`  wrote ${(size / 2 ** 30).toFixed(2)} GiB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    check('file is larger than 2 GiB', size > 2 ** 31);

    let readFileErr = '';
    try { await fs.promises.readFile(file); } catch (e: any) { readFileErr = e.code; }
    check('fs.readFile (old byte path) refuses it', readFileErr === 'ERR_FS_FILE_TOO_LARGE', readFileErr || 'read OK');

    // Measure in a fresh child process: this one is bloated from writing
    // the file. VmHWM = kernel-recorded peak RSS.
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, [__filename, '--child', file], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const m = JSON.parse(out.trim().split('\n').pop()!);
    check(`streams at factor 2 → ${N / 2}³`, m.dims === `${N / 2},${N / 2},${N / 2}` && m.stride === 2,
      `${m.secs.toFixed(0)} s (${(size / 2 ** 20 / m.secs).toFixed(0)} MiB/s)`);
    const grow = m.peak - m.base;
    check('peak RSS growth ≤ 1.3 × output + 64 MiB', grow <= 1.3 * m.outBytes + (64 << 20),
      `+${(grow / 2 ** 20).toFixed(0)} MiB peak for a ${(m.outBytes / 2 ** 20).toFixed(0)} MiB output grid (file ${(size / 2 ** 20).toFixed(0)} MiB)`);
    check('blob peak where it was written (0.4, 0.5, 0.6)', m.peakAt.every((v: number, a: number) => Math.abs(v - [0.4, 0.5, 0.6][a]) < 0.01),
      `value ${m.peakVal.toFixed(3)} at (${m.peakAt.map((v: number) => v.toFixed(3)).join(', ')})`);
    fs.unlinkSync(file);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
