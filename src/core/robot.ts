/**
 * Robot Framework / SeleniumLibrary export.
 *
 * Verified against SeleniumLibrary 6.9.0 libdoc. Two things drive the output:
 *
 *  1. SeleniumLibrary locates elements with an explicit `strategy:value` prefix
 *     (id, name, class, tag, xpath, css, dom, link, partial link, data, jquery).
 *     `strategy:value` is preferred over `strategy=value` — the latter collides
 *     with Robot's own named-argument syntax.
 *
 *  2. There is NO shadow-DOM strategy. Nothing in the library pierces a shadow
 *     boundary, so anything nested in one has to go through `dom:` with a
 *     hand-written querySelector chain. We emit that chain rather than a css:
 *     locator that would silently never match.
 *
 *  3. Nothing crosses an iframe boundary either. Unlike Playwright, Selenium
 *     has a current frame, and a locator only ever addresses that frame — so an
 *     element inside one needs Select Frame first and Unselect Frame after.
 *     Without them the locator is not wrong, it simply never matches, which is
 *     the worst way for a test to fail.
 */
import type { PickResult } from './types';
import { LIBRARY_KEYWORDS } from './library-keywords';
import { carriesGeneratedToken, classify, isGeneratedId, isUseless, isVolatile } from './volatility';

export interface RobotLocator {
  /** e.g. "data:testid:confirm-order" */
  value: string;
  strategy: 'id' | 'name' | 'data' | 'link' | 'class' | 'css' | 'xpath' | 'dom';
  /** Why this strategy, or what to watch out for. */
  note: string;
  /**
   * This locator is riding on something that changes when the page is restyled
   * or reworded — a class, a link's text, a position in the tree. It works
   * right now and will not survive much.
   */
  fragile: boolean;
  /** Frames to Select Frame into, outermost first. Empty in the top document. */
  frames: string[];
}

/** `data:id:my_id` matches data-id — so the prefix is stripped from the attribute. */
const DATA_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-automation-id'];

/** A value containing the separator would be parsed as part of the strategy. */
const safeForPrefix = (v: string) => !v.includes(':') && !v.includes('=');

export function toRobotLocator(result: PickResult): RobotLocator {
  const frames = result.hops
    .filter((h) => h.type === 'iframe')
    .map((h) => frameLocator(h.hostSelector));
  const guessed = result.hops.some((h) => h.type === 'iframe' && h.reliable === false);

  const base = baseLocator(result);
  return {
    ...base,
    // The value goes into a file Robot will read, and Robot eats a backslash of
    // its own before anything downstream sees one. A shoelace.style button
    // carrying `title="Press \\ to toggle"` needs the backslash to survive
    // three readers in a row — Robot, then JavaScript, then the CSS parser —
    // and it was surviving only two.
    value: robotSafe(base.value),
    frames: frames.map(robotSafe),
    note: guessed
      ? `${base.note} · ⚠ the frame selector is a guess — a cross-origin parent hides the real one`
      : base.note,
  };
}

/**
 * A locator on its way into a Robot file.
 *
 * `\\` in a cell is an escaped backslash and `${` starts a variable, so both
 * have to be written as themselves. Nothing else in a locator is Robot syntax.
 */
function robotSafe(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\$\{/g, '\\${');
}

/** `#checkout` addresses a frame as `id:checkout`; anything else goes through css:. */
function frameLocator(hostSelector: string): string {
  const id = /^#([\w-]+)$/.exec(hostSelector);
  return id?.[1] && safeForPrefix(id[1]) ? `id:${id[1]}` : `css:${hostSelector}`;
}

/** The locator within its own frame — frames are handled by the caller. */
/**
 * A selector on its way into a JavaScript string.
 *
 * The backslash has to go first or the quote escape escapes itself. Recorded on
 * shoelace.style, where a button carries `title="Press \\ to toggle"`: the
 * backslash reached the expression unescaped, JavaScript read `\\ ` as an
 * escaped space, and `document.querySelector` looked for a title that nothing
 * had. The suite failed with "Cannot read properties of null" — a message about
 * the chain, for a problem in the first link of it.
 */
function jsLiteral(selector: string): string {
  return selector
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function baseLocator(result: PickResult): Omit<RobotLocator, 'frames'> {
  const a = result.attributes;
  const tag = result.tagName;

  // Shadow DOM first — it overrides everything, because no prefix works there.
  // Only shadow hops belong in the chain: an iframe is not a shadowRoot, and
  // walking one as though it were produces an expression that throws.
  const shadowHops = result.hops.filter((h) => h.type === 'shadow');
  if (shadowHops.length) {
    const chain = shadowHops
      .map((h) => `querySelector('${jsLiteral(h.hostSelector)}').shadowRoot`)
      .join('.');
    const leaf = cssFor(result);
    return {
      strategy: 'dom',
      value: `dom:document.${chain}.querySelector('${jsLiteral(leaf)}')`,
      note: 'SeleniumLibrary has no shadow-DOM strategy — a dom: expression is the only way in',
      fragile: false,
    };
  }

  for (const attr of DATA_ATTRS) {
    const v = a[attr];
    if (v && safeForPrefix(v)) {
      // The attribute is durable; the value need not be. A hook with a row id
      // in it belongs to one seeded database.
      const recordId = carriesGeneratedToken(v);
      return {
        strategy: 'data',
        value: `data:${attr.slice('data-'.length)}:${v}`,
        note: recordId
          ? '⚠ test hook carrying a record id — another environment will have a different one'
          : 'dedicated test hook — the most durable locator available',
        fragile: recordId,
      };
    }
  }

  const id = a['id'];
  // An id the scorer calls worthless is worthless here too. This branch read
  // the attribute directly and never asked, so React 19's useId —
  // `_R_ajekmbjqfsua_`, regenerated on every render — came out as the best
  // locator the page had, described as the fastest thing to resolve.
  if (id && safeForPrefix(id) && !classify(id).volatile) {
    return isGeneratedId(id)
      ? {
          strategy: 'id',
          value: `id:${id}`,
          note: '⚠ a component library counter, not a name — it shifts if anything renders above it',
          fragile: true,
        }
      : { strategy: 'id', value: `id:${id}`, note: 'fastest for the browser to resolve', fragile: false };
  }

  const name = a['name'];
  if (name && safeForPrefix(name)) {
    return {
      strategy: 'name',
      value: `name:${name}`,
      note: 'form field name — tied to the backend contract',
      fragile: false,
    };
  }

  // `link:` matches on text, so it is only a locator when one link carries it.
  // A list of profiles has a "View profile" on every row, and the strategy
  // would quietly mean the first.
  const linkTextIsUnique = result.linkTextMatches === 1;
  if (
    tag === 'a' && linkTextIsUnique &&
    result.text && result.text.length <= 60 && safeForPrefix(result.text)
  ) {
    return {
      strategy: 'link',
      value: `link:${result.text}`,
      note: '⚠ breaks on copy edits and in other locales',
      fragile: true,
    };
  }

  const css = cssFor(result);
  const candidate = bestCssCandidate(result);
  const ambiguous = !!candidate && candidate.matches !== 1;

  // A lone class is more readable as class: than as css: — but only when it
  // means one element.
  const soleClass = /^[a-z]+\.([\w-]+)$/i.exec(css);
  if (soleClass?.[1] && safeForPrefix(soleClass[1])) {
    return {
      strategy: 'class',
      value: `class:${soleClass[1]}`,
      note: ambiguous
        ? `⚠ matches ${candidate?.matches} elements — Selenium will take the first one`
        : '⚠ class-based — will not survive a redesign',
      fragile: true,
    };
  }

  // A css: fallback is only as good as the candidate underneath it: an
  // [aria-label] selector is fine, an nth-of-type chain is a countdown.
  // A path hanging from a counter id is as good as the counter, which is to
  // say it is good until something renders above it. The candidate already
  // knows; saying "no stable attribute found" here threw that away.
  const counterAnchored = candidate?.notes.find((n) => n.includes('counter'));

  return {
    strategy: 'css',
    value: `css:${css}`,
    note: ambiguous
      ? `⚠ matches ${candidate?.matches} elements — Selenium will take the first one`
      : counterAnchored ?? 'no stable attribute found — consider asking for a data-testid',
    fragile: ambiguous || !candidate || candidate.kind === 'path' || candidate.score < 55,
  };
}

/** Best CSS-expressible candidate, falling back to the tag name. */
function cssFor(result: PickResult): string {
  return bestCssCandidate(result)?.value ?? result.tagName;
}

/**
 * Highest-scoring candidate that actually picks out one element.
 *
 * Score alone is not enough. `class:mat-mdc-form-field-infix` scores
 * respectably and matches twenty-one elements on the page it came from, so
 * Selenium takes the first — some other field entirely — and the test fails
 * somewhere else, or worse, quietly does the wrong thing. An ugly selector
 * that means one element beats a readable one that means twenty; when nothing
 * is unique the pick is marked fragile rather than dressed up.
 */
function bestCssCandidate(result: PickResult) {
  const css = result.candidates
    .filter((c) => c.engine === 'css')
    .sort((a, b) => b.score - a.score);
  return css.find((c) => c.matches === 1) ?? css[0];
}

export interface RobotAction {
  /** SeleniumLibrary keyword. Doubles as the id of the action. */
  keyword: string;
  /** Extra argument column, e.g. the text to type or the value to assert. */
  argument?: string;
  /**
   * The argument is a list: Select From List By Label takes any number of
   * labels, and a multiple select is the only way to choose more than one.
   */
  variadic?: boolean;
  /**
   * How the generated keyword is named. `verb` puts it in front
   * ("Click Export CSV"), `suffix` behind ("Export CSV Should Be Enabled").
   */
  verb?: string;
  suffix?: string;
  /**
   * Select Radio Button and Radio Button Should Be Set To are the keywords here
   * that do NOT take a locator: their signature is (group_name, value), where
   * group_name is the radio group's name attribute and value is the radio's id
   * or value. Passing a locator would fail at runtime, so they get their own
   * rendering path.
   */
  takesLocator: boolean;
}

const act = (keyword: string, extra: Omit<Partial<RobotAction>, 'keyword'> = {}): RobotAction => ({
  keyword,
  takesLocator: true,
  ...extra,
});

const ENABLED = act('Element Should Be Enabled', { suffix: 'Should Be Enabled' });
const DISABLED = act('Element Should Be Disabled', { suffix: 'Should Be Disabled' });
const TEXT_IS = act('Element Text Should Be', { suffix: 'Text Should Be', argument: '${EXPECTED}' });
const CONTAINS = act('Element Should Contain', { suffix: 'Should Contain', argument: '${EXPECTED}' });
const VALUE_IS = act('Textfield Value Should Be', { suffix: 'Value Should Be', argument: '${EXPECTED}' });
const CLEAR = act('Clear Element Text', { verb: 'Clear' });

/**
 * The keywords worth offering for an element, most likely first. Deliberately
 * three or four: past that, reading the list costs more than typing the keyword
 * by hand. A test is mostly assertions, so each list pairs the obvious action
 * with the checks people actually write against that kind of element.
 *
 * Using the specific keyword matters — Click Button also matches on the value
 * attribute, Click Link on href and link text, while Click Element only knows
 * id and name.
 */
export function robotActionsFor(result: PickResult): RobotAction[] {
  const tag = result.tagName;
  const type = (result.attributes['type'] ?? '').toLowerCase();

  if (tag === 'select') {
    // A multiple select takes as many labels as were chosen, and clearing it is
    // its own keyword — Select From List By Label with nothing to select is not
    // a way to deselect anything.
    if (result.attributes['multiple'] !== undefined) {
      return [
        act('Select From List By Label', { verb: 'Select', argument: '@{LABELS}', variadic: true }),
        act('Unselect From List By Label', { verb: 'Unselect', argument: '@{LABELS}', variadic: true }),
        act('Unselect All From List', { verb: 'Clear' }),
        act('List Selection Should Be', { suffix: 'Selection Should Be', argument: '@{LABELS}', variadic: true }),
      ];
    }
    return [
      act('Select From List By Label', { verb: 'Select', argument: '${LABEL}' }),
      act('List Selection Should Be', { suffix: 'Selection Should Be', argument: '${LABEL}' }),
      DISABLED,
    ];
  }
  if (tag === 'textarea') {
    return [act('Input Text', { verb: 'Fill', argument: '${TEXT}' }), VALUE_IS, CLEAR];
  }
  if (tag === 'a') {
    return [act('Click Link', { verb: 'Click' }), CONTAINS, TEXT_IS];
  }
  if (tag === 'button') {
    return [act('Click Button', { verb: 'Click' }), ENABLED, DISABLED, TEXT_IS];
  }

  if (tag === 'input') {
    switch (type) {
      case 'password':
        return [act('Input Password', { verb: 'Fill', argument: '${PASSWORD}' }), CLEAR, DISABLED];
      case 'checkbox':
        return [
          act('Select Checkbox', { verb: 'Check' }),
          act('Unselect Checkbox', { verb: 'Uncheck' }),
          act('Checkbox Should Be Selected', { suffix: 'Should Be Selected' }),
          act('Checkbox Should Not Be Selected', { suffix: 'Should Not Be Selected' }),
        ];
      case 'radio':
        return [
          act('Select Radio Button', { verb: 'Choose', takesLocator: false }),
          act('Radio Button Should Be Set To', { suffix: 'Should Be Set To', takesLocator: false }),
        ];
      case 'file':
        return [act('Choose File', { verb: 'Upload', argument: '${FILE_PATH}' })];
      case 'submit':
      case 'button':
      case 'reset':
        return [act('Click Button', { verb: 'Click' }), ENABLED, DISABLED];
      default:
        // Click Element belongs here because clicking a field is sometimes the
        // action: a date input opens a picker rather than taking a caret.
        return [
          act('Input Text', { verb: 'Fill', argument: '${TEXT}' }),
          VALUE_IS,
          CLEAR,
          act('Click Element', { verb: 'Click' }),
          DISABLED,
        ];
    }
  }
  return [act('Click Element', { verb: 'Click' }), TEXT_IS, CONTAINS];
}

/** `keyword` picks one of the alternatives; the primary action is the default. */
export function toRobotCode(result: PickResult, keyword?: string): string {
  const actions = robotActionsFor(result);
  const action = actions.find((a) => a.keyword === keyword) ?? actions[0]!;
  return action.takesLocator ? renderLocatorKeyword(result, action) : renderRadioKeyword(result, action);
}

/**
 * ${CHECKOUT_FRAME} rather than ${FRAME_1} whenever the selector says enough to
 * name it.
 */
export function frameVarNames(frames: string[]): string[] {
  const taken = new Set<string>();
  return frames.map((frame) => {
    const ident = /^id:([\w-]+)$/.exec(frame)?.[1] ?? /iframe[#.]([\w-]+)/.exec(frame)?.[1];
    const cleaned = ident?.replace(/\W+/g, '_').toUpperCase();
    // "outer-frame" already says frame; ${OUTER_FRAME_FRAME} says it twice.
    const base = cleaned ? (/FRAME/.test(cleaned) ? cleaned : `${cleaned}_FRAME`) : 'FRAME';
    let name = base;
    let n = 2;
    while (taken.has(name)) name = `${base}_${n++}`;
    taken.add(name);
    return name;
  });
}

function renderLocatorKeyword(result: PickResult, action: RobotAction): string {
  const locator = toRobotLocator(result);
  const varName = variableName(result);
  const args = [`\${${varName}}`, ...(action.argument ? [action.argument] : [])].join('    ');
  const frameVars = frameVarNames(locator.frames);

  const header = locator.strategy === 'dom'
    ? [
        '# ⚠ This element lives inside a shadow root. SeleniumLibrary 6.9 has no',
        '#   locator strategy that pierces shadow boundaries, so a dom: expression',
        '#   is the supported workaround.',
      ]
    : [];

  return [
    ...header,
    '*** Variables ***',
    ...frameVars.map((name, i) => `\${${name}}${pad(name)}${locator.frames[i]}`),
    `# ${locator.note}`,
    `\${${varName}}${pad(varName)}${locator.value}`,
    '',
    '*** Keywords ***',
    keywordName(action, varName),
    ...frameVars.map((name) => `    Select Frame    \${${name}}`),
    `    Wait Until Element Is Visible    \${${varName}}    timeout=10s`,
    `    ${action.keyword}    ${args}`,
    // One Unselect Frame is enough at any depth: it returns to the main frame,
    // not one level up.
    ...(frameVars.length ? ['    Unselect Frame'] : []),
  ].join('\n');
}

/**
 * Both radio keywords take (group_name, value) — plain attribute values, so
 * there is no locator variable to define. The wait still needs one, and name:
 * is the only strategy guaranteed to find a member of the group.
 */
function renderRadioKeyword(result: PickResult, action: RobotAction): string {
  const group = result.attributes['name'] ?? '${GROUP_NAME}';
  const value = result.attributes['value'] ?? result.attributes['id'] ?? '${VALUE}';
  const varName = variableName(result);

  return [
    '*** Variables ***',
    `# ${action.keyword} takes the group name and the button's value — not a locator`,
    `\${${varName}_GROUP}${pad(varName + '_GROUP')}${group}`,
    `\${${varName}_VALUE}${pad(varName + '_VALUE')}${value}`,
    '',
    '*** Keywords ***',
    keywordName(action, varName),
    `    Wait Until Page Contains Element    name:${group}    timeout=10s`,
    `    ${action.keyword}    \${${varName}_GROUP}    \${${varName}_VALUE}`,
  ].join('\n');
}

/**
 * "Click Export CSV" for actions, "Export CSV Should Be Enabled" for assertions.
 *
 * Never a name the library already has. Robot resolves a suite's own keywords
 * before a library's, so `Click Button` calling `Click Button` calls itself —
 * which is what an element with nothing to be named after but its tag produces.
 * Recorded on shoelace.style, where the button lives in a shadow root and
 * carries no id, no label and no text of its own.
 *
 * "The" rather than a number: no keyword in the library starts with it, and
 * "Click Button 2" in a suite with no "Click Button 1" is a puzzle for whoever
 * reads it next.
 */
export function keywordName(action: RobotAction, varName: string): string {
  const title = titleCase(varName);
  const name = action.suffix ? `${title} ${action.suffix}` : `${action.verb ?? 'Use'} ${title}`;
  return TAKEN_BY_LIBRARY.has(normalise(name)) ? `The ${name}` : name;
}

const normalise = (name: string): string => name.toLowerCase().replace(/[\s_]/g, '');
const TAKEN_BY_LIBRARY = new Set(LIBRARY_KEYWORDS.map(normalise));

/** Pad the variable column to 24 chars, the usual Robot alignment. */
function pad(varName: string): string {
  // Combining marks sit on top of the letter before them and take no column of
  // their own, so ${ราคารวมทั้งหมด} is narrower than its length suggests.
  const printed = varName.replace(/\p{M}/gu, '').length;
  const width = Math.max(4, 24 - printed - 3);
  return ' '.repeat(width);
}

export function variableName(result: PickResult): string {
  const a = result.attributes;
  const source =
    DATA_ATTRS.map((k) => a[k]).find(Boolean) ??
    a['id'] ??
    a['name'] ??
    a['aria-label'] ??
    // A <select>'s textContent is every option run together, which names it
    // ${JANUARYFEBRUARYMARCH…DECEMBER}. Its options are not its identity, and
    // neither is an editor's text: ProseMirror's demo came out as
    // ${HELLO_PROSEMIRRORTHIS_IS}, which is a name for what someone typed once.
    (result.tagName === 'select' || isEditable(a) ? undefined : textName(result.text)) ??
    // A spinner has none of the above but usually says what it is in a class.
    // ${LOADING_SPINNER} beats ${DIV} in a suite someone has to read.
    identifyingClass(a['class']) ??
    result.tagName;

  // ${CATEGORY_01M2ZB0KQPPRAXR26GHEA7SJ2K} names nothing a person can read. The
  // id belongs in the locator, where it is doing a job, and not in the name.
  const named = (source || result.tagName)
    .split(/([-_/.\s]+)/)
    .filter((part) => !(part.length >= 8 && isVolatile(part)))
    .join('');

  const cleaned = (named || result.tagName)
    .normalize('NFKD')
    // Fold Latin diacritics only. Stripping every combining mark would take
    // the vowels and tones out of Thai with them — ยืนยัน would come out ยนยน — and
    // those marks are letters here, not decoration.
    .replace(/[\u0300-\u036f]/g, '')
    // Keep letters and digits of any script, drop punctuation. The old rule
    // was `[^\w\s-]`, which deleted every non-Latin character on the page:
    // a button reading ยืนยันการสั่งซื้อ was named ${BUTTON_TARGET}.
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return cleaned || `${result.tagName.toUpperCase()}_TARGET`;
}

/** Is this the thing an editor edits? */
const isEditable = (attributes: Record<string, string>): boolean =>
  attributes['contenteditable'] === '' || attributes['contenteditable'] === 'true';

/** The first few words of an element's text, if that is short enough to be a name. */
function textName(text: string): string | undefined {
  const words = text.trim().split(/\s+/).slice(0, 3).join(' ');
  return words && words.length <= 40 ? words : undefined;
}

/** The first class that names the thing rather than styling it. */
function identifyingClass(classAttr: string | undefined): string | undefined {
  return classAttr?.split(/\s+/).filter(Boolean).find((c) => !isUseless(c));
}

/** Words a tester would keep shouting: "Click Export CSV", not "Click Export Csv". */
const ACRONYMS = new Set([
  'csv', 'pdf', 'url', 'uri', 'id', 'api', 'ok', 'sms', 'otp', 'qr', 'ui', 'ux',
  'html', 'xml', 'json', 'css', 'http', 'https', 'sql', 'faq', 'cta', 'kpi', 'db',
]);

function titleCase(varName: string): string {
  return varName
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
