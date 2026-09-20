/**
 * What counts as a name, and what is a build artefact wearing one.
 *
 * These rules decide every locator the tool emits, and they have been wrong
 * three times: emotion classes carrying a label slipped past a pattern written
 * for bare hashes, Angular Material's counters scored as identity, and
 * Tailwind's `shrink-0` was read as a name — which is how a step came to be
 * called "Click Shrink 0".
 *
 * Each row below is a string seen on a real page. The ones marked keep must
 * survive, because over-matching here silently downgrades good locators into
 * nth-child chains.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CASES = [
  // [token, expected, where it was seen]
  ['css-1x9d8f', 'volatile', 'emotion'],
  ['css-1nmdiq5-menu', 'volatile', 'emotion with a label, from react-select'],
  ['css-1dimb5e-singleValue', 'volatile', 'emotion with a label'],
  ['sc-bdVaJa', 'volatile', 'styled-components'],
  ['jss128', 'volatile', 'JSS'],
  ['makeStyles-root-12', 'volatile', 'MUI'],
  ['_ngcontent-abc-c12', 'volatile', 'Angular view encapsulation'],
  ['Button_root__3kD9a', 'volatile', 'CSS modules'],
  ['_R_ajekmbjqfsua_', 'volatile', 'React 19 useId, from the Ant Design docs'],
  [':r7:', 'volatile', 'React 18 useId'],
  ['data-v-7ba5bd90', 'volatile', 'Vue scoped styles, from the Element Plus docs'],
  ['a1b2c3d4e5f6a7b8', 'volatile', 'hex hash'],
  ['order-20260918001', 'volatile', 'ends in a record id'],

  ['shrink-0', 'utility', 'Tailwind flex child'],
  ['grow', 'utility', 'Tailwind'],
  ['truncate', 'utility', 'Tailwind'],
  ['overflow-hidden', 'utility', 'Tailwind'],
  ['md:flex', 'utility', 'Tailwind at a breakpoint'],
  ['px-4', 'utility', 'Tailwind spacing'],
  ['items-center', 'utility', 'Tailwind alignment'],
  ['rounded-lg', 'utility', 'Tailwind'],

  // camelCase is every-letter-different once it is long enough, which is what
  // the entropy rule measures. DemoQA's date field was thrown out for it.
  ['dateOfBirthInput', 'keep', 'DemoQA — a name, not a hash'],
  ['autoCompleteMultipleInput', 'keep', 'DemoQA'],
  ['submitOrderButton', 'keep', 'camelCase, long'],

  // State classes: stable strings that name a moment, not an element.
  ['is-focused', 'utility', 'Element Plus, while the select has focus'],
  ['ant-select-open', 'utility', 'Ant Design, while the list is open'],
  ['Mui-checked', 'utility', 'MUI'],
  ['tab--active', 'utility', 'a BEM modifier'],
  ['has-error', 'utility', 'Bootstrap-flavoured'],

  ['login-form', 'keep', 'an ordinary class'],
  ['el-select__wrapper', 'keep', 'Element Plus, the element itself'],
  ['inventory_item_name', 'keep', 'Saucedemo'],
  ['pay-btn', 'keep', 'an ordinary class'],
  ['css-grid-area', 'keep', 'starts with css- but is not a hash'],
  ['label-hard', 'keep', 'from the BugJam app'],
  ['bug-step-1', 'keep', 'a numbered field that means something'],
  ['subjects-auto-complete__multi-value', 'keep', 'BEM, not a hash'],
];

const GENERATED_IDS = [
  ['mat-select-0', true, 'Angular Material'],
  ['mat-option-72', true, 'Angular Material'],
  ['mat-mdc-checkbox-0-input', true, 'Angular Material'],
  ['cdk-overlay-3', true, 'Angular CDK'],
  ['react-select-2-option-0', true, 'react-select'],
  ['mui-42', true, 'MUI'],
  ['el-id-1024-3', true, 'Element Plus'],

  ['login-email', false, 'the BugJam app'],
  ['bug-step-1', false, 'the BugJam app'],
  ['material-price', false, 'starts with mat but is a word'],
  ['file-upload', false, 'the-internet'],
  ['column-a', false, 'the-internet'],
];

const work = mkdtempSync(path.join(tmpdir(), 'zelector-scoring-'));
writeFileSync(path.join(work, 'probe.ts'), `
  import { classify, isGeneratedId } from '@/core/volatility';
  const tokens = ${JSON.stringify(CASES.map(([t]) => t))};
  const ids = ${JSON.stringify(GENERATED_IDS.map(([t]) => t))};
  process.stdout.write(JSON.stringify({
    tokens: tokens.map((t) => {
      const v = classify(t);
      return v.volatile ? 'volatile' : v.utility ? 'utility' : 'keep';
    }),
    ids: ids.map(isGeneratedId),
  }));
`);
execFileSync('npx', ['esbuild', path.join(work, 'probe.ts'), '--bundle', '--format=esm',
  '--platform=node', '--alias:@=./src', `--outfile=${path.join(work, 'probe.mjs')}`,
  '--log-level=error'], { stdio: 'inherit' });
const got = JSON.parse(execFileSync('node', [path.join(work, 'probe.mjs')], { encoding: 'utf8' }));
rmSync(work, { recursive: true, force: true });

let failures = 0;

CASES.forEach(([token, expected, seen], i) => {
  const actual = got.tokens[i];
  if (actual === expected) {
    console.log(`ok    ${expected.padEnd(8)} ${token}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${token} — expected ${expected}, got ${actual}  (${seen})`);
  }
});

GENERATED_IDS.forEach(([id, expected, seen], i) => {
  const actual = got.ids[i];
  if (actual === expected) {
    console.log(`ok    ${(expected ? 'counter' : 'name').padEnd(8)} ${id}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${id} — expected ${expected ? 'a counter' : 'a name'}  (${seen})`);
  }
});

console.log(failures ? `\n${failures} scoring rule(s) wrong.` : '\nEvery scoring rule holds.');
process.exit(failures ? 1 : 0);
