/**
 * Which navigations a click explains.
 *
 * The recorder used to decide with a stopwatch: within the grace, the click
 * did it; later, a person typed it. A slow site breaks that — a recording of
 * data.go.th came out as click, Go To, click, Go To, so every replay reloads
 * the page it has just arrived at and every banner on it animates twice.
 *
 * Each row is a link, a URL the page ended up at, and whether the one explains
 * the other.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CASES = [
  // [href, page the link was on, where we ended up, led here?, why]
  ['/dataset/', 'https://data.go.th/', 'https://data.go.th/dataset/', true, 'root-relative, from data.go.th'],
  ['/dataset', 'https://data.go.th/', 'https://data.go.th/dataset/', true, 'the server added the slash'],
  ['/dataset/', 'https://data.go.th/', 'https://data.go.th/dataset/#top', true, 'a fragment the browser kept'],
  ['dataset/', 'https://data.go.th/landing/', 'https://data.go.th/landing/dataset/', true, 'relative to the page'],
  ['https://data.go.th/group/', 'https://data.go.th/', 'https://data.go.th/group/', true, 'absolute'],

  ['/dataset/', 'https://data.go.th/', 'https://data.go.th/group/', false, 'went somewhere else'],
  ['/dataset/', 'https://data.go.th/', 'https://example.com/dataset/', false, 'another host'],
  [undefined, 'https://data.go.th/', 'https://data.go.th/dataset/', false, 'not a link at all'],
  ['#section', 'https://data.go.th/', 'https://data.go.th/dataset/', false, 'an anchor is not a page'],
  ['javascript:void(0)', 'https://data.go.th/', 'https://data.go.th/dataset/', false, 'no destination in it'],
];

const out = mkdtempSync(path.join(tmpdir(), 'zelector-nav-'));
execFileSync('npx', ['esbuild', 'src/core/navigation.ts', '--bundle', '--format=esm', '--platform=node',
  `--outfile=${path.join(out, 'navigation.mjs')}`, '--log-level=error'], { stdio: 'inherit' });
const { linkLedTo } = await import(path.join(out, 'navigation.mjs'));
rmSync(out, { recursive: true, force: true });

let failures = 0;
for (const [href, from, url, expected, why] of CASES) {
  const got = linkLedTo(href === undefined ? undefined : { href, from }, url);
  if (got === expected) {
    console.log(`ok    ${String(href).padEnd(28)} → ${expected ? 'the click' : 'by hand '}  (${why})`);
  } else {
    failures += 1;
    console.log(`FAIL  ${String(href).padEnd(28)} → expected ${expected}, got ${got}  (${why})`);
  }
}

console.log();
console.log(failures
  ? `${failures} of ${CASES.length} navigation rules are wrong.`
  : 'Every navigation is credited to the right thing.');
process.exit(failures ? 1 : 0);
