/**
 * Heuristics for "will this identifier still exist after the next deploy?"
 *
 * Build tools generate class names and ids that look stable but are hashed from
 * file content — `css-1x9d8f`, `Button_root__3kD9a`, `_ngcontent-abc-c12`.
 * Anything matching these patterns is worthless as a selector, so we detect and
 * penalise it rather than handing the user a selector that breaks next Tuesday.
 */

const GENERATED_PATTERNS: Array<[RegExp, string]> = [
  // Emotion labels its output when the babel plugin is on: css-1nmdiq5-menu,
  // css-1dimb5e-singleValue. The hash is still the whole of the identity.
  [/^css-[a-z0-9]{5,}(?:-[\w-]+)?$/i, 'emotion/styled generated class'],
  [/^sc-[a-zA-Z0-9]{5,}$/,             'styled-components generated class'],
  [/^jss\d+$/,                          'JSS generated class'],
  [/^makeStyles-/,                      'MUI makeStyles generated class'],
  [/^_ngcontent-|^_nghost-|^ng-tns-/,  'Angular view-encapsulation attribute'],
  [/^[\w-]+__[\w-]+___[a-zA-Z0-9]{4,}$/, 'CSS-modules hashed class'],
  [/^[\w-]+_[\w-]+__[a-zA-Z0-9]{4,}$/,   'CSS-modules hashed class'],
  [/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, 'UUID'],
  [/^[a-f0-9]{16,}$/i,                  'hex hash'],
  [/^:r[0-9a-z]+:$/,                    'React useId value'],
  [/^radix-:/,                          'Radix UI generated id'],
  [/^headlessui-/,                      'Headless UI generated id'],
  [/^mui-\d+$/,                         'MUI generated id'],
  [/\d{4,}$/,                           'ends in a long number — likely an index or record id'],
];

/** Tailwind/utility classes are stable but say nothing about *which* element this is. */
const UTILITY_PATTERNS: RegExp[] = [
  /^(?:sm|md|lg|xl|2xl|hover|focus|active|group-hover|dark|first|last|odd|even):/,
  /^-?(?:m|p)[trblxy]?-/,
  /^(?:w|h|min-w|min-h|max-w|max-h)-/,
  /^(?:flex|grid|inline|block|hidden|absolute|relative|fixed|sticky)$/,
  /^(?:text|bg|border|ring|shadow|rounded|opacity|z|gap|space)-/,
  /^(?:items|justify|content|self|place)-/,
  // Flex/grid children, and the layout-only classes that turn up on the exact
  // wrapper divs a custom dropdown puts under the cursor. `shrink-0` was being
  // scored as identity, which is how a step ends up called "Click Shrink 0".
  /^(?:shrink|grow|basis|order|col|row)(?:-|$)/,
  /^(?:truncate|uppercase|lowercase|capitalize|italic|underline|antialiased)$/,
  /^(?:overflow|object|whitespace|break|cursor|select|pointer-events|align)-/,
  /^(?:transition|duration|ease|animate|delay)(?:-|$)/,
  /^(?:leading|tracking|font|list|divide|outline|ring|backdrop|filter|blur)-/,
  /^(?:top|right|bottom|left|inset|translate|rotate|scale|skew|origin)-/,
  /\[.+\]$/, // Tailwind arbitrary value, e.g. w-[calc(100%-2rem)]
];

export interface Verdict {
  volatile: boolean;
  /** Stable, but carries no identity — styling only. */
  utility: boolean;
  reason?: string;
}

export function classify(token: string): Verdict {
  for (const [re, reason] of GENERATED_PATTERNS) {
    if (re.test(token)) return { volatile: true, utility: false, reason };
  }
  for (const re of UTILITY_PATTERNS) {
    if (re.test(token)) return { volatile: false, utility: true, reason: 'utility/styling class' };
  }
  if (entropy(token) > 3.6 && token.length >= 8 && !/[-_]/.test(token)) {
    return { volatile: true, utility: false, reason: 'high-entropy string — looks generated' };
  }
  return { volatile: false, utility: false };
}

/**
 * Ids a component library hands out from a running counter: mat-select-0,
 * mat-option-72, cdk-overlay-3.
 *
 * They are not hashed, and the number is not a name: the counter is global and
 * handed out in render order, so it moves when anything renders before it.
 * Positional, in other words, exactly like nth-child — it just does not look
 * like it.
 *
 * On a page that renders asynchronously it is worse than that, and not only
 * across code changes. Measured on the Angular Material docs, three loads of
 * the same URL: `mat-input-0` was `/Volvo/Saab/Mercedes` on the first and
 * `Volvo/Saab/Mercedes/Audi` on the next two. Same page, same build, different
 * element — because whichever example finishes rendering first takes the
 * lower number.
 *
 * (An earlier note here claimed these were stable between runs. That came from
 * measuring the wrong thing — the order dropdowns were opened in, rather than
 * the page being loaded again.)
 *
 * Still usually the best locator a page like that offers, so this does not
 * demote it into a structural path. It marks it, so the person recording sees
 * the problem while they still have someone to ask for a data-testid.
 */
export function isGeneratedId(id: string): boolean {
  return (
    /^(?:mat|cdk|ng|mdc|mui|pn|pv|rc|react-select|downshift|headless)[-_][\w-]*\d/.test(id) ||
    /^chakra-/.test(id)
  );
}

export const isVolatile = (t: string) => classify(t).volatile;
export const isUseless = (t: string) => {
  const v = classify(t);
  return v.volatile || v.utility;
};

/** Shannon entropy per character — generated ids score high, human words low. */
function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
