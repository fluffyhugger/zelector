/**
 * The generated suites, committed, and compared on every run.
 *
 * Parsing catches invalid Robot. The capture cases catch a recorder that reads
 * the page wrongly. Neither notices output that is valid, well-formed and
 * quietly worse — which is what happened when an anchor lost `link:Terms of
 * Service` and gained `css:a`, a selector matching every link on the page.
 * That got through four suites and was only found by diffing against the
 * version already sent to the store.
 *
 * So the output lives in the repository. Any change to it shows up as a diff,
 * where it can be read and either accepted or not.
 *
 *   npm run test:snapshot            compare
 *   npm run test:snapshot -- --update   accept what changed
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SNAPSHOTS = 'scripts/snapshots';
const update = process.argv.includes('--update');

const work = mkdtempSync(path.join(tmpdir(), 'zelector-snapshot-'));
execFileSync('npx', ['esbuild', 'scripts/fixtures.ts', '--bundle', '--format=esm', '--platform=node',
  '--alias:@=./src', `--outfile=${path.join(work, 'fixtures.mjs')}`, '--log-level=error'],
  { stdio: 'inherit' });
execFileSync('node', [path.join(work, 'fixtures.mjs')], { stdio: 'ignore', cwd: work });

const generatedDir = path.join(work, 'rf');
const generated = readdirSync(generatedDir).sort();

if (update) {
  rmSync(SNAPSHOTS, { recursive: true, force: true });
  mkdirSync(SNAPSHOTS, { recursive: true });
  for (const name of generated) {
    writeFileSync(path.join(SNAPSHOTS, name), readFileSync(path.join(generatedDir, name)));
  }
  console.log(`Recorded ${generated.length} snapshots.`);
  process.exit(0);
}

if (!existsSync(SNAPSHOTS)) {
  console.error(`No snapshots yet. Record them with:\n  npm run test:snapshot -- --update`);
  process.exit(1);
}

const stored = readdirSync(SNAPSHOTS).sort();
let problems = 0;

for (const name of generated) {
  if (!stored.includes(name)) {
    problems += 1;
    console.log(`NEW   ${name}  — accept it with --update`);
    continue;
  }
  const before = readFileSync(path.join(SNAPSHOTS, name), 'utf8');
  const after = readFileSync(path.join(generatedDir, name), 'utf8');
  if (before === after) continue;

  problems += 1;
  console.log(`DIFF  ${name}`);
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i += 1) {
    if (beforeLines[i] === afterLines[i]) continue;
    if (beforeLines[i] !== undefined) console.log(`        - ${beforeLines[i]}`);
    if (afterLines[i] !== undefined) console.log(`        + ${afterLines[i]}`);
  }
}

for (const name of stored) {
  if (!generated.includes(name)) {
    problems += 1;
    console.log(`GONE  ${name}  — the fixture that produced it no longer does`);
  }
}

rmSync(work, { recursive: true, force: true });

console.log(
  problems
    ? `\n${problems} file(s) differ. Read the diff: accept it with --update, or it is a regression.`
    : `\nAll ${generated.length} generated suites match their snapshots.`,
);
process.exit(problems ? 1 : 0);
