/**
 * Visual-regression harness for matviz CLI renderer.
 *
 * Modes:
 *   default  — render each fixture, compare to baseline PNG, report ΔRGB,
 *              exit 0 on gate pass / 1 on fail.
 *   --update-baseline — render each fixture and overwrite its baseline PNG.
 *                       Exits 0 unconditionally. Use after intentional
 *                       rendering changes; review the diff in git before commit.
 *
 * A "fixture" is a subdirectory under test/visual/fixtures/ containing a
 * scene.json describing how to render. The structure file referenced by
 * scene.json's `input` is resolved relative to the fixture directory.
 *
 * Gate (per fixture, all must hold):
 *   p95(ΔRGB) < GATE_P95  (default 2)    — typical drift acceptable
 *   mean(ΔRGB) < GATE_MEAN (default 0.5) — overall difference acceptable
 *   max(ΔRGB)  ≤ GATE_MAX  (default 50)  — hard ceiling for catastrophic regression
 *
 * ΔRGB is per-pixel max(|ΔR|, |ΔG|, |ΔB|) on the 0–255 scale (alpha ignored).
 *
 * Exit codes:
 *   0 — all fixtures pass gate
 *   1 — at least one fixture fails gate
 *   2 — harness setup error (no fixtures, missing renderer, etc.)
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

interface SceneConfig {
  // populated by loadScene
  name: string;
  fixtureDir: string;

  // from scene.json
  input: string;
  view?: string;
  rotate?: [number, number, number];
  supercell?: [number, number, number];
  palette?: 'dark' | 'light';
  width?: number;
  height?: number;
  style?: 'ball-and-stick' | 'space-filling' | 'stick' | 'wireframe';
  camera?: 'ortho' | 'persp';
  bg?: string;
  noBoundary?: boolean;
  noBonds?: boolean;
  noCell?: boolean;
  labels?: boolean;
  polyhedra?: boolean;
  polyhedraCenters?: string[];
  iso?: number;
}

interface FixtureResult {
  name: string;
  width: number;
  height: number;
  mismatchedPixels: number;
  maxDelta: number;
  meanDelta: number;
  p95Delta: number;
  gatePass: boolean;
  note: string;
}

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, 'test/visual/fixtures');
const BASELINE_DIR = path.join(ROOT, 'test/visual/baseline');
const DIFF_DIR = path.join(ROOT, 'test/visual/diff');
const RENDER_CMD = path.join(ROOT, 'dist/render.js');

const GATE_P95 = 2;
const GATE_MEAN = 0.5;
const GATE_MAX = 50;

function loadScene(dir: string): SceneConfig {
  const cfgPath = path.join(dir, 'scene.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`scene.json missing in ${dir}`);
  }
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Omit<SceneConfig, 'name' | 'fixtureDir'>;
  return { ...raw, name: path.basename(dir), fixtureDir: dir };
}

function buildArgs(cfg: SceneConfig, outPath: string): string[] {
  const inputPath = path.resolve(cfg.fixtureDir, cfg.input);
  const args = [inputPath, '-o', outPath];
  if (cfg.view) args.push('--view', cfg.view);
  if (cfg.rotate) args.push('--rotate', cfg.rotate.join(','));
  if (cfg.supercell) args.push('--supercell', cfg.supercell.join(','));
  if (cfg.palette) args.push('--palette', cfg.palette);
  if (cfg.width != null) args.push('--width', String(cfg.width));
  if (cfg.height != null) args.push('--height', String(cfg.height));
  if (cfg.style) args.push('--style', cfg.style);
  if (cfg.camera) args.push('--camera', cfg.camera);
  if (cfg.bg) args.push('--bg', cfg.bg);
  if (cfg.noBoundary) args.push('--no-boundary');
  if (cfg.noBonds) args.push('--no-bonds');
  if (cfg.noCell) args.push('--no-cell');
  if (cfg.labels) args.push('--labels');
  if (cfg.polyhedra) args.push('--polyhedra');
  if (cfg.polyhedraCenters) args.push('--polyhedra-centers', cfg.polyhedraCenters.join(','));
  if (cfg.iso != null) args.push('--iso', String(cfg.iso));
  return args;
}

function render(cfg: SceneConfig, outPath: string): void {
  if (!fs.existsSync(RENDER_CMD)) {
    throw new Error(`Renderer not built: ${RENDER_CMD}. Run npm run build.`);
  }
  const args = buildArgs(cfg, outPath);
  execFileSync('node', [RENDER_CMD, ...args], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
}

function readPNG(p: string): { width: number; height: number; data: Buffer } {
  const png = PNG.sync.read(fs.readFileSync(p));
  return { width: png.width, height: png.height, data: png.data };
}

function computeDeltaStats(a: Buffer, b: Buffer): { max: number; mean: number; p95: number } {
  const n = Math.min(a.length, b.length);
  const pixelCount = n / 4;
  // Histogram over 0..255 instead of allocating a deltas[] array (4-element
  // 800×600 image = 480k entries; histogram is 256 ints).
  const histo = new Uint32Array(256);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const d = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
    histo[d]++;
    sum += d;
    if (d > max) max = d;
  }
  const mean = sum / pixelCount;
  const p95Index = Math.floor(0.95 * pixelCount);
  let cum = 0;
  let p95 = 0;
  for (let v = 0; v < 256; v++) {
    cum += histo[v];
    if (cum >= p95Index) { p95 = v; break; }
  }
  return { max, mean, p95 };
}

function diffFixture(cfg: SceneConfig, livePath: string, baselinePath: string, diffPath: string): FixtureResult {
  const live = readPNG(livePath);
  const base = readPNG(baselinePath);
  if (live.width !== base.width || live.height !== base.height) {
    return {
      name: cfg.name,
      width: live.width,
      height: live.height,
      mismatchedPixels: live.width * live.height,
      maxDelta: 255,
      meanDelta: 255,
      p95Delta: 255,
      gatePass: false,
      note: `size mismatch: live=${live.width}×${live.height} vs baseline=${base.width}×${base.height}`,
    };
  }
  const diffData = Buffer.alloc(live.data.length);
  // pixelmatch threshold=0.05 → ~12.75 ΔRGB cutoff per pixel for "mismatched"
  // count; doesn't affect our own ΔRGB stats which are computed independently.
  const mismatched = pixelmatch(
    new Uint8Array(live.data.buffer, live.data.byteOffset, live.data.byteLength),
    new Uint8Array(base.data.buffer, base.data.byteOffset, base.data.byteLength),
    new Uint8Array(diffData.buffer, diffData.byteOffset, diffData.byteLength),
    live.width, live.height,
    { threshold: 0.05 },
  );
  // Persist diff PNG (red pixels = differences)
  const diffPng = new PNG({ width: live.width, height: live.height });
  diffData.copy(diffPng.data);
  fs.writeFileSync(diffPath, PNG.sync.write(diffPng));

  const stats = computeDeltaStats(live.data, base.data);
  const gatePass = stats.max <= GATE_MAX && stats.mean < GATE_MEAN && stats.p95 < GATE_P95;
  return {
    name: cfg.name,
    width: live.width,
    height: live.height,
    mismatchedPixels: mismatched,
    maxDelta: stats.max,
    meanDelta: stats.mean,
    p95Delta: stats.p95,
    gatePass,
    note: '',
  };
}

function discoverFixtures(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs.readdirSync(FIXTURES_DIR)
    .map(n => path.join(FIXTURES_DIR, n))
    .filter(p => fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'scene.json')))
    .sort();
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');

  const fixtureDirs = discoverFixtures();
  if (fixtureDirs.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}. Each fixture is a subdir with scene.json.`);
    return 2;
  }
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.mkdirSync(DIFF_DIR, { recursive: true });

  console.log(`matviz visual harness — ${fixtureDirs.length} fixtures, mode=${updateBaseline ? 'UPDATE_BASELINE' : 'COMPARE'}`);
  console.log(`Gate (compare mode): max ≤ ${GATE_MAX}, mean < ${GATE_MEAN}, p95 < ${GATE_P95}`);

  const results: FixtureResult[] = [];
  let allPass = true;

  for (const dir of fixtureDirs) {
    let cfg: SceneConfig;
    try {
      cfg = loadScene(dir);
    } catch (e) {
      console.error(`[${path.basename(dir)}] ${(e as Error).message}`);
      allPass = false;
      continue;
    }
    const livePath = path.join(DIFF_DIR, `${cfg.name}_live.png`);
    const baselinePath = path.join(BASELINE_DIR, `${cfg.name}.png`);
    const diffPath = path.join(DIFF_DIR, `${cfg.name}_diff.png`);

    process.stdout.write(`[${cfg.name}] rendering... `);
    const t0 = Date.now();
    try {
      render(cfg, livePath);
    } catch (e) {
      const err = e as { stderr?: Buffer; message?: string };
      const stderr = err.stderr ? err.stderr.toString().slice(-300) : err.message || String(e);
      console.error(`FAILED in render\n${stderr}`);
      allPass = false;
      continue;
    }
    const renderMs = Date.now() - t0;
    process.stdout.write(`(${renderMs} ms) `);

    if (updateBaseline) {
      fs.copyFileSync(livePath, baselinePath);
      console.log(`baseline updated`);
      results.push({
        name: cfg.name, width: 0, height: 0, mismatchedPixels: 0,
        maxDelta: 0, meanDelta: 0, p95Delta: 0, gatePass: true, note: 'baseline updated',
      });
      continue;
    }

    if (!fs.existsSync(baselinePath)) {
      console.error(`baseline missing — run with --update-baseline first`);
      allPass = false;
      continue;
    }

    const result = diffFixture(cfg, livePath, baselinePath, diffPath);
    if (!result.gatePass) allPass = false;
    console.log(`max=${result.maxDelta} mean=${result.meanDelta.toFixed(2)} p95=${result.p95Delta} mismatched=${result.mismatchedPixels} → ${result.gatePass ? 'pass' : 'FAIL'}`);
    results.push(result);
  }

  console.log('\n## Summary');
  console.log('| Fixture | W×H | mismatched | max ΔRGB | mean ΔRGB | p95 ΔRGB | gate |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const mode = r.note === 'baseline updated' ? '(baseline)' : String(r.mismatchedPixels);
    const max = r.note === 'baseline updated' ? '—' : String(r.maxDelta);
    const mean = r.note === 'baseline updated' ? '—' : r.meanDelta.toFixed(2);
    const p95 = r.note === 'baseline updated' ? '—' : String(r.p95Delta);
    const gate = r.note === 'baseline updated' ? 'UPDATED' : (r.gatePass ? '✓' : '✗ FAIL');
    console.log(`| ${r.name} | ${r.width}×${r.height} | ${mode} | ${max} | ${mean} | ${p95} | ${gate} |`);
  }
  console.log('');

  if (updateBaseline) {
    console.log('Baseline mode — gate not evaluated. Review diffs in git before commit.');
    return 0;
  }
  return allPass ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  console.error('harness fatal:', err);
  process.exit(2);
});
