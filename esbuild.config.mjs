import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const USE_ESM_SPLITTING = true;

// Clean dist before building (skip in watch mode)
if (!watch) {
  rmSync('dist', { recursive: true, force: true });
}

const baseConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],
  platform: 'node',
  sourcemap: true,
  minify: true,
};

const ctx = await esbuild.context(
  USE_ESM_SPLITTING
    ? {
        ...baseConfig,
        format: 'esm',
        splitting: true,
        outdir: 'dist',
        chunkNames: 'chunks/[name]-[hash]',
      }
    : {
        ...baseConfig,
        format: 'cjs',
        outfile: 'dist/extension.js',
      }
);

if (watch) {
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Build complete.');
}
