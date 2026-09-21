/**
 * Candidate generation + stability scoring.
 *
 * The premise of Zelector: never hand back a single selector. Generate every
 * reasonable way to reach the element, score each on how likely it is to survive
 * a redeploy, and let the user pick with the trade-off visible.
 *
 * Every candidate here is a CSS selector, because every target left is one that
 * takes CSS: Robot Framework through SeleniumLibrary, Selenium itself, and the
 * plain CSS and XPath copies. The picker used to offer `getByRole(...)`,
 * `getByLabel(...)` and `getByText(...)` beside them — Playwright expressions,
 * from when the tool tried to serve Playwright too. Nothing could use them, so
 * they were three rows of a list that a person has to read before choosing.
 */
import type { SelectorCandidate, SelectorKind } from './types';
import { carriesGeneratedToken, classify, isGeneratedId, isUseless } from './volatility';
import {
  ancestors, countMatches, esc, isUnique, normalizeText,
  nthOfType, queryInScope, quote,
} from './dom';

/** Checked in order — the first one present wins, so keep the strongest first. */
const TEST_ATTRIBUTES = [
  'data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa',
  'data-qa-id', 'data-automation-id', 'data-e2e', 'data-track-id',
];

/** Attributes that describe *what the element is*, not how it looks. */
const SEMANTIC_ATTRIBUTES = ['name', 'type', 'href', 'placeholder', 'title', 'alt', 'for', 'role'];

/** Base score by kind, before penalties. */
const BASE_SCORE: Record<SelectorKind, number> = {
  testid: 98, id: 85, name: 82, aria: 80, attr: 60, class: 45, path: 20,
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
    const recordId = carriesGeneratedToken(value);
    push({
      kind: 'testid', engine: 'css', value: unique ? sel : `${tag}${sel}`,
      penalty: (unique ? 0 : 10) + (recordId ? 14 : 0),
      notes: [
        `purpose-built test hook (${attr})`,
        unique ? 'unique on page' : 'not unique — tag added',
        ...(recordId
          ? ['⚠ carries a record id — another environment will have a different one']
          : []),
      ],
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
      // A hashed id has to score below the structural path, not merely below
      // the good handles. On the Ant Design docs the trigger's only id was a
      // React 19 useId value: the Robot export had already been taught to
      // refuse it, but a penalty of 55 still left `css:#_R_ajekmbjqfsua_`
      // ahead of the path, so the recording shipped it anyway. A locator that
      // is regenerated on every render is worth less than nth-of-type, which
      // at least survives until the markup changes.
      penalty: (verdict.volatile ? 72 : 0) + (unique ? 0 : 25),
      notes: [
        verdict.volatile ? `⚠ ${verdict.reason} — will change on rebuild` : 'stable-looking id',
        ...(unique ? [] : ['⚠ duplicate id on page — invalid HTML']),
      ],
    });
  }

  // ── 3. Form controls: name= ────────────────────────────────────────────────
  if (/^(input|select|textarea)$/.test(tag)) {
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

  // ── 4. aria-label ──────────────────────────────────────────────────────────
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = `[aria-label=${quote(ariaLabel)}]`;
    push({
      kind: 'aria', engine: 'css', value: isUnique(el, sel) ? sel : `${tag}${sel}`,
      penalty: isUnique(el, sel) ? 0 : 12,
      notes: ['accessibility label — changes only with the UI copy'],
    });
  }

  // ── 5. Other semantic attributes ───────────────────────────────────────────
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

  // ── 6. Class combination ───────────────────────────────────────────────────
  const classCandidate = buildClassSelector(el);
  if (classCandidate) out.push(classCandidate);

  // ── 7. Structural path — always available, always last ─────────────────────
  out.push(buildPathSelector(el));

  return dedupe(out).sort((a, b) => b.score - a.score);
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
  let anchoredOnCounter = false;

  while (current && depth < 12) {
    const tag = current.tagName.toLowerCase();
    const anchor = anchorFor(current);
    if (anchor) {
      parts.unshift(anchor.value);
      anchored = true;
      anchoredOnCounter = anchor.counter;
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
    ...(anchored
      ? [anchoredOnCounter
          ? '⚠ anchored to a component library counter — it moves with render order'
          : 'anchored to a stable ancestor']
      : []),
  ];

  return {
    kind: 'path', engine: 'css', value,
    matches: countMatches(el, value),
    score: Math.max(2, BASE_SCORE.path - depth * 2 + (anchored ? 12 : 0) - (indexed ? 6 : 0)),
    notes,
  };
}

/** A stable hook on an ancestor we can root the path at. */
/**
 * Where a structural path can start from, and whether that start is a name.
 *
 * Anchoring on a counter id is still worth doing — `#pn_id_7 > span` beats
 * eight levels of nth-of-type — but the path is then exactly as fragile as the
 * counter it hangs from, and it was being handed over with the note for an
 * ordinary path. Recorded on PrimeNG, whose every component id is a counter.
 */
function anchorFor(el: Element): { value: string; counter: boolean } | null {
  for (const attr of TEST_ATTRIBUTES) {
    const v = el.getAttribute(attr);
    if (v) return { value: `[${attr}=${quote(v)}]`, counter: false };
  }
  const id = el.getAttribute('id');
  if (id && !classify(id).volatile && isUnique(el, `#${esc(id)}`)) {
    return { value: `#${esc(id)}`, counter: isGeneratedId(id) };
  }
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

