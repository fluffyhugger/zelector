/**
 * Packages dist/ for the Chrome Web Store.
 *
 * The store requires manifest.json at the ZIP root — not inside a folder — so
 * this zips the *contents* of dist/, not the directory itself.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const manifestPath = 'dist/manifest.json';
if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json not found — run `npm run build:store` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const out = path.resolve('release', `zelector-${manifest.version}.zip`);

mkdirSync('release', { recursive: true });
rmSync(out, { force: true });

// -r recurse, -X drop macOS resource forks the store does not want.
execFileSync('zip', ['-r', '-X', out, ...readdirSync('dist')], { cwd: 'dist', stdio: 'inherit' });

const size = (readFileSync(out).length / 1024).toFixed(1);
console.log(`\n${path.relative(process.cwd(), out)}  (${size} KB)`);
console.log(`version ${manifest.version} · ${manifest.permissions?.length ?? 0} permissions · host: ${(manifest.host_permissions ?? []).join(', ') || 'none'}`);
console.log('\nUpload at https://chrome.google.com/webstore/devconsole');
