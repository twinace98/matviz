/**
 * v0.23.1 Feature 23.1.2 — header-only volumetric preflight tests.
 *
 * - Every volumetric fixture: probe dims = file dims, effectiveDims = parsed
 *   grid dims (XSF closure planes), grid count = parsed grid count.
 * - Synthetic cube / XSF (closure, no closure, two grids) / CHGCAR (ISPIN 1, 2,
 *   SOC): same checks, plus recommendedDims = what the byte parser produces at
 *   that cap.
 * - A 2.5 GB file (real header + data head, sparse tail): probe < 200 ms and
 *   reads < 2 MiB.
 *
 * Build: esbuild.mjs → dist/test-volumetric-probe.js
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { probeVolumetric, dimsForFactor, bytesForFactor, resolutionChoices, VolumetricProbe } from '../src/parsers/volumetricProbe';
import { chooseStride, VOLUMETRIC_SAFETY_MAX_GRID_POINTS } from '../src/parsers/types';
import { parseStructureFileTraj, parseStructureFileTrajFromBytes } from '../src/parsers/index';
import { synthCube, synthXsf, synthChgcar } from './lib/synthGrids';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const eq = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matviz-probe-'));
const root = path.resolve(__dirname, '..');

async function compare(label: string, file: string, parseAs: string, opts: { gridsExact?: boolean } = {}) {
  const p = await probeVolumetric(file, parseAs);
  const text = fs.readFileSync(file, 'utf8');
  const grids = parseStructureFileTraj(text, parseAs).volumetrics ?? [];
  const g0 = grids[0];
  const rawGridCount = p.format === 'chgcar' ? (grids.length === 4 && grids[2].name === 'spin_up' ? 2 : grids.length) : grids.length;
  check(`${label}: effectiveDims = parsed dims`, !!g0 && eq(p.effectiveDims, g0.dims), `${p.dims.join('×')} → ${p.effectiveDims.join('×')} (parsed ${g0?.dims.join('×')}), closure ${JSON.stringify(p.redundantEndpoint)} [${p.endpointSource}]`);
  if (opts.gridsExact !== false) {
    check(`${label}: grid count`, p.gridCount === rawGridCount && p.outputGridCount === grids.length,
      `file ${p.gridCount}${p.gridCountEstimated ? ' (est.)' : ''} / loaded ${p.outputGridCount}; parser ${rawGridCount} / ${grids.length}; ${p.bytesPerValue.toFixed(1)} B/value`);
  } else {
    console.log(`  info ${label}: grid count est. ${p.gridCount} vs parser ${rawGridCount} (fixture too small for a size-based estimate)`);
  }
  return p;
}

(async () => {
  console.log('[fixtures]');
  for (const [rel, as, exact] of [
    ['test/fixtures/h2o.cube', 'h2o.cube', true],
    ['test/fixtures/LiF-polaron-isolevel.xsf', 'LiF.xsf', true],
    ['test/fixtures/band15_Gamma.xsf', 'band15.xsf', true],
    ['test/fixtures/xsf-two-datagrid.xsf', 'two.xsf', false],
    ['test/fixtures/chgcar-collinear-spin', 'CHGCAR', false],
    ['test/fixtures/chgcar-soc-noncollinear', 'CHGCAR', false],
  ] as const) {
    await compare(path.basename(rel), path.join(root, rel), as, { gridsExact: exact });
  }

  console.log('[synthetic]');
  const synth: Array<[string, string, string]> = [
    ['cube 33³', 'a.cube', synthCube(33)],
    ['xsf 31³ closure', 'b.xsf', synthXsf(31, 1, true)],
    ['xsf 30³ no closure', 'c.xsf', synthXsf(30, 1, false)],
    ['xsf 31³ ×2 grids', 'd.xsf', synthXsf(31, 2, true)],
    ['CHGCAR 29³ ISPIN=1', 'CHGCAR', synthChgcar(29, 1)],
    ['CHGCAR 29³ ISPIN=2', 'CHGCAR', synthChgcar(29, 2)],
    ['CHGCAR 29³ SOC', 'CHGCAR', synthChgcar(29, 4)],
  ];
  for (const [label, as, text] of synth) {
    const dir = fs.mkdtempSync(path.join(tmp, 's-'));
    const file = path.join(dir, as);
    fs.writeFileSync(file, text);
    const p = await compare(label, file, as);
    // recommendedDims at a forced factor-3 budget must equal the byte parser's output dims.
    const cap = dimsForFactor(p, 3).reduce((a, b) => a * b, 1);
    const p3 = await probeVolumetric(file, as, { maxGridPoints: cap });
    const parsed = parseStructureFileTrajFromBytes(new Uint8Array(fs.readFileSync(file)), as, { maxGridPoints: cap }).volumetrics![0];
    check(`${label}: recommendedDims at cap ${cap} = byte parser dims`, p3.recommendedFactor === 3 && eq(p3.recommendedDims, parsed.dims),
      `factor ${p3.recommendedFactor} → ${p3.recommendedDims.join('×')} (parser ${parsed.dims.join('×')}), ${(bytesForFactor(p3, 3) / 1024).toFixed(0)} KiB`);
  }

  console.log('[2.5 GB file, sparse tail]');
  {
    const N = 1200;
    const file = path.join(tmp, 'huge.cube');
    const h = 10 / N / 0.529177249;
    const head = `big\nsparse\n1 0 0 0\n${N} ${h} 0 0\n${N} 0 ${h} 0\n${N} 0 0 ${h}\n8 8.0 1 1 1\n`;
    const line = ' 1.234567e-03 -2.345678e-04 3.456789e-05 4.567890e-06 5.678901e-07 6.789012e-08\n';
    fs.writeFileSync(file, head + line.repeat(3000));
    fs.truncateSync(file, 2.5e9);
    const t0 = process.hrtime.bigint();
    const p = await probeVolumetric(file);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    check('dims 1200³, file size 2.5 GB', eq(p.dims, [N, N, N]) && p.fileSize === 2.5e9);
    check('probe < 200 ms', ms < 200, `${ms.toFixed(1)} ms`);
    check('reads < 2 MiB', p.bytesRead < 2 << 20, `${(p.bytesRead / 1024).toFixed(0)} KiB`);
    check('full-res estimate and recommended factor', p.fullResBytes === 4 * N ** 3 && p.recommendedFactor === 2 && eq(p.recommendedDims, [600, 600, 600]),
      `${(p.fullResBytes / 2 ** 30).toFixed(2)} GiB full → factor ${p.recommendedFactor} → ${p.recommendedDims.join('×')} (${(bytesForFactor(p, 2) / 2 ** 30).toFixed(2)} GiB)`);
    fs.unlinkSync(file);
  }

  console.log('[resolution prompt choices]');
  {
    const fake = (n: number, grids = 1): VolumetricProbe => {
      const p = {
        format: 'cube', fileSize: 0, dims: [n, n, n], effectiveDims: [n, n, n], gridCount: grids, gridCountEstimated: false,
        outputGridCount: grids, fullResBytes: 4 * n ** 3 * grids, recommendedFactor: chooseStride(n, n, n, VOLUMETRIC_SAFETY_MAX_GRID_POINTS),
        recommendedDims: [0, 0, 0], redundantEndpoint: [false, false, false], endpointSource: 'none', dataOffset: 0, bytesPerValue: 13, bytesRead: 0,
      } as VolumetricProbe;
      p.recommendedDims = dimsForFactor(p, p.recommendedFactor);
      return p;
    };
    const show = (c: ReturnType<typeof resolutionChoices>) => c.map(x => `${x.kind} ${x.dims[0]}³ ${(x.bytes / 2 ** 30).toFixed(2)}G`).join(' | ');
    const GiB = 2 ** 30;
    const c1 = resolutionChoices(fake(1200), GiB);
    check('1200³ (6.4 GiB, over safety cap): recommended 600³, smaller 400³, no original', show(c1) === 'recommended 600³ 0.80G | smaller 400³ 0.24G', show(c1));
    const c2 = resolutionChoices(fake(700), GiB);
    check('700³ (1.28 GiB, within safety cap): recommended 350³, smaller 234³, original 700³', show(c2) === 'recommended 350³ 0.16G | smaller 234³ 0.05G | original 700³ 1.28G', show(c2));
    const c3 = resolutionChoices(fake(1000), GiB / 4);
    check('1000³ with a 0.25 GiB limit: larger = safety-cap grid 500³', show(c3) === 'recommended 334³ 0.14G | smaller 250³ 0.06G | larger 500³ 0.47G', show(c3));
    check('900³ (2.7 GiB) under a 4 GiB limit: no prompt', resolutionChoices(fake(900), 4 * GiB).length === 0);
    check('600³ (0.80 GiB) under a 1 GiB limit: no prompt', resolutionChoices(fake(600), GiB).length === 0);
    const c5 = resolutionChoices(fake(500, 4), GiB);
    check('500³ ×4 grids (1.86 GiB): counts every loaded grid', c5[0]?.factor === 2 && Math.abs(c5[0].bytes - 4 * 4 * 250 ** 3) < 1, show(c5));
    check('limit 0 = never prompt', resolutionChoices(fake(1200), 0).length === 0);
  }

  console.log('[errors]');
  {
    let msg = '';
    try { await probeVolumetric(path.join(root, 'test/fixtures/graphene.xsf'), 'graphene.xsf'); } catch (e: any) { msg = e.message; }
    check('XSF without DATAGRID → clear error', /grid header not found/.test(msg), msg);
    msg = '';
    try { await probeVolumetric(path.join(root, 'test/fixtures/nacl.cif')); } catch (e: any) { msg = e.message; }
    check('non-volumetric name → clear error', /not a volumetric/.test(msg), msg);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
