import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

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

if (watch) {
  const ctx1 = await esbuild.context(extensionConfig);
  const ctx2 = await esbuild.context(webviewConfig);
  await ctx1.watch();
  await ctx2.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(extensionConfig);
  await esbuild.build(webviewConfig);
  await esbuild.build(cliConfig);
  await esbuild.build(cliHelpersConfig);
  await esbuild.build(harnessConfig);
  await esbuild.build(parserTestConfig);
  await esbuild.build(symEigenTestConfig);
  await esbuild.build(magmomTestConfig);
  console.log('Build complete.');
}
