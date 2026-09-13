/**
 * Candidate generation + stability scoring.
 *
 * The premise of Zelector: never hand back a single selector. Generate every
 * reasonable way to reach the element, score each on how likely it is to survive
 * a redeploy, and let the user pick with the trade-off visible.
 */
import type { SelectorCandidate, SelectorKind } from './types';
import { classify, isUseless } from './volatility';
import {
  ancestors, countMatches, esc, isUnique, normalizeText,
  nthOfType, queryInScope, quote,
} from './dom';
import { accessibleName, roleOf } from './aria';

/** Checked in order — the first one present wins, so keep the strongest first. */
const TEST_ATTRIBUTES = [
  'data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa',
  'data-qa-id', 'data-automation-id', 'data-e2e', 'data-track-id',
];

/** Attributes that describe *what the element is*, not how it looks. */
const SEMANTIC_ATTRIBUTES = ['name', 'type', 'href', 'placeholder', 'title', 'alt', 'for', 'role'];

/** Base score by kind, before penalties. */
const BASE_SCORE: Record<SelectorKind, number> = {
  testid: 98, label: 92, role: 90, id: 85, name: 82,
  aria: 80, text: 68, attr: 60, class: 45, path: 20,
};

export function generateCandidates(el: Element): SelectorCandidate[] {
  const out: SelectorCandidate[] = [];
  const push = (c: Omit<SelectorCandidate, 'matches' | 'score'> & { penalty?: number; notes: string[] }) => {
    const matches = countMatches(el, c.engine === 'css' ? c.value : '*');
    out.push({
      kind: c.kind,
      engine: c.engine,
      value: c.value,
      notes: c.notes,
      matches: c.engine === 'css' ? matches : 1,
      score: Math.max(0, Math.min(100, BASE_SCORE[c.kind] - (c.penalty ?? 0))),
    });
  };

  const tag = el.tagName.toLowerCase();

  // ── 1. Dedicated test attributes ───────────────────────────────────────────
  for (const attr of TEST_ATTRIBUTES) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const sel = `[${attr}=${quote(value)}]`;
    const unique = isUnique(el, sel);
    push({
      kind: 'testid', engine: 'css', value: unique ? sel : `${tag}${sel}`,
      penalty: unique ? 0 : 10,
      notes: [`purpose-built test hook (${attr})`, unique ? 'unique on page' : 'not unique — tag added'],
    });
    break; // one test hook is enough
  }

  // ── 2. id ──────────────────────────────────────────────────────────────────
  const id = el.getAttribute('id');
  if (id) {
    const verdict = classify(id);
    const sel = `#${esc(id)}`;
    const unique = isUnique(el, sel);
    push({
      kind: 'id', engine: 'css', value: sel,
      penalty: (verdict.volatile ? 55 : 0) + (unique ? 0 : 25),
      notes: [
        verdict.volatile ? `⚠ ${verdict.reason} — will change on rebuild` : 'stable-looking id',
        ...(unique ? [] : ['⚠ duplicate id on page — invalid HTML']),
      ],
    });
  }

  // ── 3. Accessible role + name → the selector style Playwright recommends ───
  const role = roleOf(el);
  const name = accessibleName(el);
  if (role && name && name.length <= 60) {
    const dupes = countRoleMatches(el, role, name);
    push({
      kind: 'role', engine: 'playwright',
      value: `getByRole(${quoteJs(role)}, { name: ${quoteJs(name)}${/[.*+?^${}()|[\]\\]/.test(name) ? '' : ''} })`,
      penalty: dupes > 1 ? 22 : 0,
      notes: [
        'matches what a screen reader sees — survives restyling',
        ...(dupes > 1 ? [`⚠ ${dupes} elements share this role+name`] : []),
      ],
    });
  }

  // ── 4. Form controls: label, then name= ────────────────────────────────────
  if (/^(input|select|textarea)$/.test(tag)) {
    const labelText = accessibleName(el);
    if (labelText) {
      push({
        kind: 'label', engine: 'playwright', value: `getByLabel(${quoteJs(labelText)})`,
        notes: ['bound to the visible <label> — breaks only if the copy changes'],
      });
    }
    const nameAttr = el.getAttribute('name');
    if (nameAttr && !isUseless(nameAttr)) {
      const sel = `${tag}[name=${quote(nameAttr)}]`;
      push({
        kind: 'name', engine: 'css', value: sel,
        penalty: isUnique(el, sel) ? 0 : 15,
        notes: ['form field name — usually tied to the backend contract'],
      });
    }
  }

  // ── 5. aria-label ──────────────────────────────────────────────────────────
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = `[aria-label=${quote(ariaLabel)}]`;
    push({
      kind: 'aria', engine: 'css', value: isUnique(el, sel) ? sel : `${tag}${sel}`,
      penalty: isUnique(el, sel) ? 0 : 12,
      notes: ['accessibility label — changes only with the UI copy'],
    });
  }

  // ── 6. Visible text ────────────────────────────────────────────────────────
  const text = normalizeText(el.textContent);
  if (text && text.length <= 50 && !/^(html|body|head)$/.test(tag)) {
    push({
      kind: 'text', engine: 'playwright',
      value: `getByText(${quoteJs(text)}, { exact: true })`,
      penalty: text.length > 30 ? 10 : 0,
      notes: ['⚠ breaks on copy edits and in other locales'],
    });
  }

  // ── 7. Other semantic attributes ───────────────────────────────────────────
  for (const attr of SEMANTIC_ATTRIBUTES) {
    const value = el.getAttribute(attr);
    if (!value || value.length > 100 || isUseless(value)) continue;
    const sel = `${tag}[${attr}=${quote(value)}]`;
    if (!isUnique(el, sel)) continue;
    push({
      kind: 'attr', engine: 'css', value: sel,
      notes: [`unique via ${attr}=`],
    });
    break;
  }

  // ── 8. Class combination ───────────────────────────────────────────────────
  const classCandidate = buildClassSelector(el);
  if (classCandidate) out.push(classCandidate);

  // ── 9. Structural path — always available, always last ─────────────────────
  out.push(buildPathSelector(el));

  return dedupe(out).sort((a, b) => b.score - a.score);
}

/** How many elements share this role+name — cheap approximation of a11y-tree lookup. */
function countRoleMatches(el: Element, role: string, name: string): number {
  let n = 0;
  for (const candidate of queryInScope(el, '*')) {
    if (roleOf(candidate) === role && accessibleName(candidate) === name) n++;
  }
  return n;
}

function buildClassSelector(el: Element): SelectorCandidate | null {
  const classes = Array.from(el.classList);
  if (!classes.length) return null;

  const meaningful = classes.filter((c) => !isUseless(c));
  const dropped = classes.length - meaningful.length;
  if (!meaningful.length) return null;

  const tag = el.tagName.toLowerCase();
  // Add classes one at a time until unique — shortest selector that still works.
  let selector = tag;
  for (const c of meaningful) {
    selector += `.${esc(c)}`;
    if (isUnique(el, selector)) break;
  }

  const unique = isUnique(el, selector);
  const notes = ['class-based — survives layout changes but not a redesign'];
  if (dropped) notes.push(`${dropped} generated/utility class${dropped > 1 ? 'es' : ''} ignored`);
  if (!unique) notes.push(`⚠ matches ${countMatches(el, selector)} elements`);

  return {
    kind: 'class', engine: 'css', value: selector,
    matches: countMatches(el, selector),
    score: Math.max(0, BASE_SCORE.class - (unique ? 0 : 20)),
    notes,
  };
}

/**
 * Walk up until the path is unique, preferring an anchor (id/testid) over a long
 * nth-of-type chain. Depth is the main penalty — every level is another thing
 * a refactor can break.
 */
function buildPathSelector(el: Element): SelectorCandidate {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  let anchored = false;

  while (current && depth < 12) {
    const tag = current.tagName.toLowerCase();
    const anchor = anchorFor(current);
    if (anchor) {
      parts.unshift(anchor);
      anchored = true;
      break;
    }
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((c) => c.tagName === current!.tagName)
      : [];
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${nthOfType(current)})` : tag);
    current = current.parentElement;
    depth++;
  }

  const value = parts.join(' > ');
  const indexed = value.includes(':nth-of-type');
  const notes = [
    '⚠ structural — breaks whenever the markup is reordered',
    ...(indexed ? ['⚠ depends on sibling position'] : []),
    ...(anchored ? ['anchored to a stable ancestor'] : []),
  ];

  return {
    kind: 'path', engine: 'css', value,
    matches: countMatches(el, value),
    score: Math.max(2, BASE_SCORE.path - depth * 2 + (anchored ? 12 : 0) - (indexed ? 6 : 0)),
    notes,
  };
}

/** A stable hook on an ancestor we can root the path at. */
function anchorFor(el: Element): string | null {
  for (const attr of TEST_ATTRIBUTES) {
    const v = el.getAttribute(attr);
    if (v) return `[${attr}=${quote(v)}]`;
  }
  const id = el.getAttribute('id');
  if (id && !classify(id).volatile && isUnique(el, `#${esc(id)}`)) return `#${esc(id)}`;
  return null;
}

function dedupe(list: SelectorCandidate[]): SelectorCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = `${c.engine}::${c.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function quoteJs(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Used by ancestors() consumers that want the chain rendered for display. */
export function describeAncestry(el: Element): string {
  return [el, ...ancestors(el)]
    .slice(0, 5)
    .reverse()
    .map((n) => n.tagName.toLowerCase())
    .join(' › ');
}
