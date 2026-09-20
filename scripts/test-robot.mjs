/**
 * Generates a .robot file per element kind and parses each with the real Robot
 * Framework parser. Requires a venv with robotframework installed:
 *
 *   python3 -m venv .venv && .venv/bin/pip install robotframework
 *   npm run test:robot
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const python = ['.venv/bin/python', '.venv/bin/python3'].find(existsSync);
if (!python) {
  console.error('No .venv found. Run:\n  python3 -m venv .venv && .venv/bin/pip install robotframework');
  process.exit(1);
}

const out = mkdtempSync(path.join(tmpdir(), 'zelector-robot-'));
execFileSync('npx', ['esbuild', 'scripts/fixtures.ts', '--bundle', '--format=esm', '--platform=node',
  '--alias:@=./src', `--outfile=${path.join(out, 'fixtures.mjs')}`, '--log-level=error'], { stdio: 'inherit' });
execFileSync('node', [path.join(out, 'fixtures.mjs')], { stdio: 'inherit', cwd: out });

const script = `
from robot.api import get_model
from robot.parsing.model.visitor import ModelVisitor
import glob, sys, os
os.chdir(${JSON.stringify(out)})

class Errors(ModelVisitor):
    def __init__(self): self.problems = []
    def visit_Error(self, node): self.problems.extend(node.errors)

bad = 0
for p in sorted(glob.glob('rf/*.robot')):
    v = Errors(); v.visit(get_model(p))
    if v.problems:
        bad += 1
        print('FAIL ', p)
        for e in v.problems: print('       ', e)
    else:
        print('ok   ', p)
sys.exit(1 if bad else 0)
`;
execFileSync(python, ['-c', script], { stdio: 'inherit' });

/**
 * A variable nothing refers to is a step that was dropped after its locator had
 * already been claimed — which is how a dialog step left `class:no-js` sitting
 * in the Variables table of a real recording.
 */
const orphans = [];
for (const file of readdirSync(path.join(out, 'rf')).filter((f) => f.endsWith('.robot'))) {
  const text = readFileSync(path.join(out, 'rf', file), 'utf8');
  // Only the suites. A single-element export is all Keywords and no test case,
  // so everything in it would read as unused.
  const start = text.indexOf('*** Test Cases ***');
  if (start === -1) continue;
  const body = text.slice(start);
  // Not [A-Z_0-9]: a variable named in the language of the page it came from
  // would slip past the check entirely, which is the opposite of what it is for.
  const declared = [...text.matchAll(/^\$\{([^}]+)\}\s{2,}/gm)].map((m) => m[1]);
  const unused = declared.filter((name) => !body.includes(`\${${name}}`));
  if (unused.length) orphans.push(`${file}: ${unused.join(', ')}`);
}

if (orphans.length) {
  console.log('\nVariables declared and never used:');
  for (const line of orphans) console.log(`  ${line}`);
  process.exit(1);
}

console.log('\nAll generated Robot Framework files parse cleanly, with nothing declared unused.');
