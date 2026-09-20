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
  // React 19 changed the shape: _R_ajekmbjqfsua_ rather than :r3:. Same thing,
  // regenerated on every render, and it was being scored as the best locator
  // the page had to offer.
  [/^_R_[a-z0-9]*_$/i,                  'React useId value'],
  [/^«r[0-9a-z]+»$/,                    'React useId value'],
  // Vue's scoped styles stamp every element in a component with the same
  // build-time hash: data-v-7ba5bd90. Nothing reaches for it as a locator today
  // — attributes are chosen from an allowlist — but it is a hash wearing a
  // data- prefix, and the allowlist is the only thing standing between it and a
  // selector that breaks on the next build.
  [/^data-v-[0-9a-f]{6,}$/i,           'Vue scoped-style attribute'],
  [/^radix-:/,                          'Radix UI generated id'],
  [/^headlessui-/,                      'Headless UI generated id'],
  [/^mui-\d+$/,                         'MUI generated id'],
  [/\d{4,}$/,                           'ends in a long number — likely an index or record id'],
];

/**
 * Classes a component adds while it is in a state, and takes away again.
 *
 * `is-focused`, `ant-select-open`, `Mui-checked`. They are stable strings and
 * they name nothing: a locator built from one matches only while the element
 * happens to be in that state, which during a replay it is not — an Element
 * Plus recording came out as `div.el-select__wrapper.is-focused` and failed on
 * its first step, waiting ten seconds for a class that only exists once the
 * select has been clicked. The thing it was supposed to click.
 */
const STATE_PATTERNS: RegExp[] = [
  /^(?:is|has)-/,
  /^Mui-/,
  /(?:^|[-_])(?:open|opened|closed|active|inactive|selected|checked|focused|focus|hover|hovered|pressed|expanded|collapsed|disabled|enabled|loading|busy|dragging|invalid|error|current|visible|hidden|shown)$/i,
  /--(?:open|active|selected|focused|checked|expanded|disabled|loading)(?:-|$)/i,
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
  for (const re of STATE_PATTERNS) {
    if (re.test(token)) {
      return {
        volatile: false,
        utility: true,
        reason: 'state class — only there while the element is in that state',
      };
    }
  }
  for (const re of UTILITY_PATTERNS) {
    if (re.test(token)) return { volatile: false, utility: true, reason: 'utility/styling class' };
  }
  if (entropy(token) > 3.6 && token.length >= 8 && !/[-_]/.test(token) && !readsAsWords(token)) {
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
    // `el-id-1024-3` is Element Plus: a namespace seed and a counter. It holds
    // still across reloads of the same page, and moves the moment anything
    // renders before it — which is what the flag is for.
    /^(?:mat|cdk|ng|mdc|mui|pn|pv|rc|el|react-select|downshift|headless)[-_][\w-]*\d/.test(id) ||
    /^chakra-/.test(id)
  );
}

export const isVolatile = (t: string) => classify(t).volatile;
export const isUseless = (t: string) => {
  const v = classify(t);
  return v.volatile || v.utility;
};

/**
 * camelCase reads as high entropy once it is long enough: every letter
 * different and no separator to split on. `dateOfBirthInput` scored 3.7 and was
 * thrown out as a hash — which is how DemoQA's date field came to be located by
 * `input.react-datepicker-ignore-onclickoutside`, a class the library adds only
 * while the calendar is open and which is therefore absent at the moment the
 * replay needs to click the field.
 *
 * A generated token is one run of characters. A name has word boundaries, and
 * every word in it has a vowel.
 */
function readsAsWords(token: string): boolean {
  const words = token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/);
  return words.length >= 2 && words.every((w) => w.length >= 2 && /[aeiouy]/i.test(w));
}

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
