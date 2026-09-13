import esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

/** Each entry becomes its own bundle — MV3 content scripts cannot share chunks. */
const entryPoints = {
  content: 'src/content/index.ts',
  'main-world': 'src/main-world/index.ts',
  background: 'src/background/service-worker.ts',
  devtools: 'src/devtools/devtools.ts',
  panel: 'src/devtools/panel.ts',
};

const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['src/devtools/devtools.html', 'devtools.html'],
  ['src/devtools/panel.html', 'panel.html'],
  ['icons', 'icons'],
];

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  for (const [from, to] of staticFiles) {
    await cp(from, path.join(outdir, to), { recursive: true });
  }
}

const ctx = await esbuild.context({
  entryPoints,
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  alias: { '@': path.resolve('src') },
  loader: { '.css': 'text' },
  plugins: [
    {
      name: 'copy-static',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) {
            await copyStatic();
            console.log(`[zelector] dist/ ready — chrome://extensions → Load unpacked`);
          }
        });
      },
    },
  ],
});

await rm(outdir, { recursive: true, force: true });

if (watch) {
  await ctx.watch();
  console.log('[zelector] watching…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
