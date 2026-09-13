/**
 * Generates a .robot file per element kind and parses each with the real Robot
 * Framework parser. Requires a venv with robotframework installed:
 *
 *   python3 -m venv .venv && .venv/bin/pip install robotframework
 *   npm run test:robot
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
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
console.log('\nAll generated Robot Framework files parse cleanly.');
