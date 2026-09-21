/**
 * Code nothing reaches.
 *
 * Three times in two days: `renderDialog` was written, documented and never
 * called, so every recorded alert came out as a click on `css:html`;
 * `countRoleMatches` outlived the candidate that used it; `src/core/aria.ts`
 * became ninety lines reachable from nothing. The first of those shipped.
 *
 * Dead code is not only waste here — it reads as evidence. Someone looking for
 * how dialogs are handled finds a renderer that handles them, and stops
 * looking.
 *
 * Exported types are left alone: a type nothing imports costs nothing and
 * carries no claim about behaviour.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
};

const sources = new Map(walk('src').map((f) => [f, readFileSync(f, 'utf8')]));
const scripts = walk('scripts').concat(
  readdirSync('scripts').filter((f) => f.endsWith('.mjs')).map((f) => path.join('scripts', f)),
);
const scriptText = scripts.map((f) => readFileSync(f, 'utf8')).join('\n');

// What the browser calls: nothing in the repo imports these.
const ENTRY = /(main-world\/index|content|background|devtools|popup)\.ts$/;

const problems = [];
for (const [file, text] of sources) {
  if (ENTRY.test(file)) continue;

  const exported = [...text.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)];
  const local = [...text.matchAll(/^(?:async )?function (\w+)/gm)];

  for (const [, name] of exported) {
    const used = [...sources].some(([other, body]) => other !== file && new RegExp(`\\b${name}\\b`).test(body))
      || new RegExp(`\\b${name}\\b`).test(scriptText);
    if (!used) {
      const here = text.match(new RegExp(`\\b${name}\\b`, 'g')).length;
      problems.push(here > 1
        ? `${file}: ${name} is exported and used only here`
        : `${file}: ${name} is exported and used nowhere`);
    }
  }

  for (const [, name] of local) {
    if (text.match(new RegExp(`\\b${name}\\b`, 'g')).length === 1) {
      problems.push(`${file}: ${name} is defined and called nowhere`);
    }
  }
}

if (problems.length) {
  for (const line of problems) console.log(`FAIL  ${line}`);
  console.log(`\n${problems.length} piece(s) of code nothing reaches.`);
  process.exit(1);
}
console.log(`Everything in ${sources.size} files is reachable.`);
