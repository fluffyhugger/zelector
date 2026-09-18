/**
 * Are these uploadable?
 *
 * The store takes 1280x800 or 640x400 and nothing else, which is the sort of
 * thing you find out after filling in every other field. `sips` is already on
 * every Mac, so the check and the fix both live here.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const dir = 'store/screenshots';
const shots = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();

if (!shots.length) {
  console.log(`no images in ${dir} yet`);
  process.exit(0);
}

const size = (file) => {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = /pixelWidth: (\d+)/.exec(out)?.[1];
  const h = /pixelHeight: (\d+)/.exec(out)?.[1];
  return [Number(w), Number(h)];
};

let wrong = 0;
for (const [i, name] of shots.entries()) {
  const [w, h] = size(path.join(dir, name));
  const ok = (w === 1280 && h === 800) || (w === 640 && h === 400);
  if (!ok) wrong += 1;
  console.log(`${ok ? 'ok  ' : 'FIX '} ${i + 1}. ${name}  ${w}x${h}`);
}

if (shots.length > 5) console.log(`\n${shots.length} images — the store takes five.`);
console.log(
  wrong
    ? `\n${wrong} to resize: node scripts/check-shots.mjs --fix`
    : '\nAll uploadable.',
);

if (process.argv.includes('--fix')) {
  for (const name of shots) {
    const file = path.join(dir, name);
    const [w, h] = size(file);
    if ((w === 1280 && h === 800) || (w === 640 && h === 400)) continue;
    // Pad rather than crop: a screenshot cropped to fit loses whichever corner
    // the interesting thing was in.
    execFileSync('sips', ['-Z', '1280', file], { stdio: 'ignore' });
    execFileSync('sips', ['-p', '800', '1280', '--padColor', '16142A', file], { stdio: 'ignore' });
    console.log(`resized ${name} → 1280x800`);
  }
}
