import * as esbuild from 'esbuild';
import { copyFileSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');

// v0.21 (feat 21.6) — the embeddable widget omits spglib WASM (the recipes/site
// sandbox forbids 'wasm-unsafe-eval' and runs on file://). Redirect the
// spglibWasm module to a no-WASM stub for the embed build ONLY, so
// @spglib/moyo-wasm never enters dist/matviz-embed.js.
const spglibEmbedStub = {
  name: 'spglib-embed-stub',
  setup(build) {
    build.onResolve({ filter: /shared[/\\]spglibWasm$/ }, () => ({
      path: path.resolve('src/shared/spglibWasm.embed.ts'),
    }));
  },
};

// v0.20.1 — copy spglib WASM artifact into dist/ (CLI renderer reads via fs)
// AND media/ (webview loads via webview.asWebviewUri). Source of truth lives
// in node_modules/@spglib/moyo-wasm/.
function copySpglibWasm() {
  const src = 'node_modules/@spglib/moyo-wasm/moyo_wasm_bg.wasm';
  const size = statSync(src).size;
  // Cap is "500 KB compressed" per v0.20 plan; raw 521 KB → ~250 KB gzipped.
  // Hard-fail if raw exceeds 700 KB to catch upstream regressions early.
  if (size > 700_000) {
    throw new Error(`spglib WASM raw size ${size} bytes exceeds 700 KB ceiling — investigate before bumping the package.`);
  }
  mkdirSync('dist', { recursive: true });
  mkdirSync('media', { recursive: true });
  copyFileSync(src, 'dist/moyo_wasm_bg.wasm');
  copyFileSync(src, 'media/moyo_wasm_bg.wasm');
  console.log(`spglib WASM: ${(size / 1024).toFixed(1)} KB raw — copied to dist/ and media/`);
}

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
};

const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
};

// v0.21 (feat 21.1) — embeddable page widget. Self-contained IIFE assigning
// window.MatViz; bundles Three.js + parsers + renderer. No 'vscode', no WASM
// (spglib aliased to a stub), no network — deployable to a static site's
// assets/lib/ and usable over file://.
const embedConfig = {
  entryPoints: ['src/webview/embed/index.ts'],
  bundle: true,
  outfile: 'dist/matviz-embed.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: false,
  minify: true,
  plugins: [spglibEmbedStub],
};

const cliConfig = {
  entryPoints: ['scripts/render.ts'],
  bundle: true,
  outfile: 'dist/render.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  external: ['puppeteer'],
};

const cliHelpersConfig = {
  entryPoints: ['scripts/render-helpers.ts'],
  bundle: true,
  outfile: 'dist/render-helpers.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: false,
};

// Visual-regression harness (16.0). Bundled as CJS so we can import
// pixelmatch (which ships ESM-only) — esbuild transpiles it inline.
// Externalize puppeteer; pixelmatch and pngjs get bundled.
const harnessConfig = {
  entryPoints: ['test/visual/harness.ts'],
  bundle: true,
  outfile: 'dist/test-visual-harness.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  external: ['puppeteer'],
};

// Parser-test harness (16.1). One-shot verification for CIF aniso parser +
// multi-loop refactor + NaN guards. Runs in pure Node (no Puppeteer).
const parserTestConfig = {
  entryPoints: ['scripts/test-aniso.ts'],
  bundle: true,
  outfile: 'dist/test-aniso.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
};

// 3×3 symmetric eigendecomposition test (16.1, 2/3). Verifies the inline
// Jacobi solver used to convert Uᵢⱼ → ellipsoid principal axes.
const symEigenTestConfig = {
  entryPoints: ['scripts/test-symeigen.ts'],
  bundle: true,
  outfile: 'dist/test-symeigen.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
};

// MAGMOM parsing test (16.3). Verifies POSCAR title-line MAGMOM extraction
// (collinear, non-collinear, compressed-form rejection, and no-MAGMOM
// regression).
const magmomTestConfig = {
  entryPoints: ['scripts/test-magmom.ts'],
  bundle: true,
  outfile: 'dist/test-magmom.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
};

// Wulff polytope test (16.4). Pure geometry sanity (no rendering): cube,
// corner-cut, Au cuboctahedron via planesFromMillerIndices.
const wulffTestConfig = {
  entryPoints: ['scripts/test-wulff.ts'],
  bundle: true,
  outfile: 'dist/test-wulff.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  // ConvexGeometry/Three pulled in via wulff.ts. external: 'three' — Node
  // can resolve it from node_modules. But Three Examples uses some browser
  // APIs that fail in Node (window, etc.) — we avoid this by NOT instantiating
  // BufferGeometry-rendering paths; ConvexGeometry's QuickHull is pure math.
};

// CrystalTrajectory bridge test (17.1.0). Verifies single-frame wrap +
// invariants. Multi-frame format-specific tests added in 17.1.1+.
const trajectoryTestConfig = {
  entryPoints: ['scripts/test-trajectory.ts'],
  bundle: true,
  outfile: 'dist/test-trajectory.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
};

// NN matching test (v0.17.1.0). Pure-math sanity for atom matching algorithm.
const nnMatchingTestConfig = {
  entryPoints: ['scripts/test-nn-matching.ts'],
  bundle: true,
  outfile: 'dist/test-nn-matching.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
};

// Tent downsampling test (v0.23.1.4). Unit + fixture drift checks.
const downsampleTestConfig = {
  entryPoints: ['scripts/test-downsample.ts'],
  bundle: true,
  outfile: 'dist/test-downsample.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
};

// Header-only volumetric preflight test (v0.23.1.2).
const probeTestConfig = {
  entryPoints: ['scripts/test-volumetric-probe.ts'],
  bundle: true,
  outfile: 'dist/test-volumetric-probe.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
};

if (watch) {
  const ctx1 = await esbuild.context(extensionConfig);
  const ctx2 = await esbuild.context(webviewConfig);
  await ctx1.watch();
  await ctx2.watch();
  console.log('Watching for changes...');
} else {
  copySpglibWasm();
  await esbuild.build(extensionConfig);
  await esbuild.build(webviewConfig);
  await esbuild.build(embedConfig);
  // v0.21 — publish a tracked copy of the embed bundle for download/vendoring.
  // dist/ is gitignored; web/matviz-embed.js is committed so site authors can
  // grab it (raw GitHub URL) and drop it into their assets/lib/. esbuild's
  // minified output is deterministic, so this only changes git when the bundle
  // actually changes.
  copyFileSync('dist/matviz-embed.js', 'web/matviz-embed.js');
  console.log('matviz-embed: copied to web/matviz-embed.js (tracked download)');
  await esbuild.build(cliConfig);
  await esbuild.build(cliHelpersConfig);
  await esbuild.build(harnessConfig);
  await esbuild.build(parserTestConfig);
  await esbuild.build(symEigenTestConfig);
  await esbuild.build(magmomTestConfig);
  await esbuild.build(wulffTestConfig);
  await esbuild.build(trajectoryTestConfig);
  await esbuild.build(nnMatchingTestConfig);
  await esbuild.build(downsampleTestConfig);
  await esbuild.build(probeTestConfig);
  console.log('Build complete.');
}
