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
  console.log('Build complete.');
}
