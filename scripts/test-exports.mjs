/**
 * Every export target, run through the tool that would have to read it.
 *
 * test-robot.mjs covers the Robot Framework output and nothing else, so the
 * rest of the targets shipped on the strength of looking right. They are
 * templates with a locator dropped in, which means the way they break is a
 * locator carrying the quote character the template uses — a class of bug that
 * only a parser notices.
 *
 * Python through ast, Java through javac against stub classes, CSS through
 * esbuild's CSS parser, JSON through JSON.parse.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = mkdtempSync(path.join(tmpdir(), 'zelector-exports-'));

execFileSync('npx', ['esbuild', 'scripts/export-run.ts', '--bundle', '--format=esm',
  '--platform=node', '--alias:@=./src', `--outfile=${path.join(out, 'run.mjs')}`,
  '--log-level=error'], { stdio: 'inherit' });

const generated = JSON.parse(
  execFileSync('node', [path.join(out, 'run.mjs')], { encoding: 'utf8' }),
);

// ── Validators ───────────────────────────────────────────────────────────────

const python = (code) =>
  execFileSync('python3', ['-c', 'import ast,sys;ast.parse(sys.stdin.read())'], {
    input: `from selenium.webdriver.common.by import By\n${code}`,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

const esbuildCheck = (loader) => (code) =>
  execFileSync('npx', ['esbuild', `--loader=${loader}`], {
    input: loader === 'css' ? `${code}{color:red}` : code,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

/**
 * javac needs the symbols to exist. Stubbing them is enough to prove the
 * snippet is well-formed Java that calls methods with the right shapes.
 */
function java(code) {
  const dir = path.join(out, 'java');
  mkdirSync(path.join(dir, 'org', 'openqa', 'selenium'), { recursive: true });
  const stub = path.join(dir, 'org', 'openqa', 'selenium');
  writeFileSync(path.join(stub, 'WebElement.java'),
    'package org.openqa.selenium;\npublic interface WebElement { void click(); void sendKeys(CharSequence... k); }\n');
  writeFileSync(path.join(stub, 'By.java'),
    'package org.openqa.selenium;\npublic class By {\n' +
    ['id', 'name', 'className', 'tagName', 'linkText', 'partialLinkText', 'cssSelector', 'xpath']
      .map((m) => `  public static By ${m}(String s) { return null; }`).join('\n') +
    '\n}\n');
  writeFileSync(path.join(stub, 'WebDriver.java'),
    'package org.openqa.selenium;\npublic interface WebDriver { WebElement findElement(By by); }\n');

  const body = code.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const file = path.join(dir, 'Snippet.java');
  writeFileSync(file,
    'import org.openqa.selenium.*;\n' +
    'public class Snippet {\n  WebDriver driver;\n  void run() {\n' +
    body.split('\n').map((l) => `    ${l}`).join('\n') +
    '\n  }\n}\n');
  execFileSync('javac', ['-nowarn', '-d', path.join(dir, 'classes'), file,
    path.join(stub, 'By.java'), path.join(stub, 'WebElement.java'), path.join(stub, 'WebDriver.java')],
    { stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * macOS ships a javac stub that exists only to tell you no JDK is installed, so
 * the check has to ask rather than assume. A missing toolchain is a skip, not a
 * failure — the same way the Robot Framework check skips without its venv.
 */
function hasJava() {
  try {
    execFileSync('javac', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const JAVA = hasJava();

const VALIDATORS = {
  'selenium-py': python,
  'selenium-java': JAVA ? java : null,
  css: esbuildCheck('css'),
  json: (code) => JSON.parse(code),
};

// ── Run ──────────────────────────────────────────────────────────────────────

let failures = 0;
for (const [target, byCase] of Object.entries(generated)) {
  if (!(target in VALIDATORS)) continue;
  const validate = VALIDATORS[target];
  if (!validate) {
    console.log(`skip  ${target} :: no JDK on this machine — install one to check it`);
    continue;
  }
  for (const [name, code] of Object.entries(byCase)) {
    try {
      validate(code);
      console.log(`ok    ${target} :: ${name}`);
    } catch (error) {
      failures += 1;
      console.log(`FAIL  ${target} :: ${name}`);
      console.log(`        ${code.replace(/\n/g, '\n        ')}`);
      const detail = error.stderr?.toString().trim() || error.message;
      console.log(`      → ${detail.split('\n').slice(0, 3).join('\n        ')}`);
    }
  }
}

console.log(
  failures
    ? `\n${failures} export(s) do not parse.`
    : `\nEvery export parses in its own language${JAVA ? '' : ' (Java skipped)'}.`,
);
process.exit(failures ? 1 : 0);
