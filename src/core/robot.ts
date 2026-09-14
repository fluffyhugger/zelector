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
 */
import type { PickResult } from './types';
import { isUseless } from './volatility';

export interface RobotLocator {
  /** e.g. "data:testid:confirm-order" */
  value: string;
  strategy: 'id' | 'name' | 'data' | 'link' | 'class' | 'css' | 'xpath' | 'dom';
  /** Why this strategy, or what to watch out for. */
  note: string;
}

/** `data:id:my_id` matches data-id — so the prefix is stripped from the attribute. */
const DATA_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-automation-id'];

/** A value containing the separator would be parsed as part of the strategy. */
const safeForPrefix = (v: string) => !v.includes(':') && !v.includes('=');

export function toRobotLocator(result: PickResult): RobotLocator {
  const a = result.attributes;
  const tag = result.tagName;

  // Shadow DOM first — it overrides everything, because no prefix works there.
  if (result.hops.some((h) => h.type === 'shadow')) {
    const chain = result.hops
      .map((h) => `querySelector('${h.hostSelector.replace(/'/g, "\\'")}').shadowRoot`)
      .join('.');
    const leaf = cssFor(result);
    return {
      strategy: 'dom',
      value: `dom:document.${chain}.querySelector('${leaf.replace(/'/g, "\\'")}')`,
      note: 'SeleniumLibrary has no shadow-DOM strategy — a dom: expression is the only way in',
    };
  }

  for (const attr of DATA_ATTRS) {
    const v = a[attr];
    if (v && safeForPrefix(v)) {
      return {
        strategy: 'data',
        value: `data:${attr.slice('data-'.length)}:${v}`,
        note: 'dedicated test hook — the most durable locator available',
      };
    }
  }

  const id = a['id'];
  if (id && safeForPrefix(id)) {
    return { strategy: 'id', value: `id:${id}`, note: 'fastest for the browser to resolve' };
  }

  const name = a['name'];
  if (name && safeForPrefix(name)) {
    return { strategy: 'name', value: `name:${name}`, note: 'form field name — tied to the backend contract' };
  }

  if (tag === 'a' && result.text && result.text.length <= 60 && safeForPrefix(result.text)) {
    return { strategy: 'link', value: `link:${result.text}`, note: '⚠ breaks on copy edits and in other locales' };
  }

  const css = cssFor(result);
  // A lone class is more readable as class: than as css:.
  const soleClass = /^[a-z]+\.([\w-]+)$/i.exec(css);
  if (soleClass?.[1] && safeForPrefix(soleClass[1])) {
    return { strategy: 'class', value: `class:${soleClass[1]}`, note: '⚠ class-based — will not survive a redesign' };
  }

  return { strategy: 'css', value: `css:${css}`, note: 'no stable attribute found — consider asking for a data-testid' };
}

/** Best CSS-expressible candidate, falling back to the tag name. */
function cssFor(result: PickResult): string {
  const css = result.candidates
    .filter((c) => c.engine === 'css')
    .sort((a, b) => b.score - a.score)[0];
  return css?.value ?? result.tagName;
}

export interface RobotAction {
  /** SeleniumLibrary keyword. Doubles as the id of the action. */
  keyword: string;
  /** Extra argument column, e.g. the text to type or the value to assert. */
  argument?: string;
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
        return [act('Input Text', { verb: 'Fill', argument: '${TEXT}' }), VALUE_IS, CLEAR, DISABLED];
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

function renderLocatorKeyword(result: PickResult, action: RobotAction): string {
  const locator = toRobotLocator(result);
  const varName = variableName(result);
  const args = [`\${${varName}}`, ...(action.argument ? [action.argument] : [])].join('    ');

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
    `# ${locator.note}`,
    `\${${varName}}${pad(varName)}${locator.value}`,
    '',
    '*** Keywords ***',
    keywordName(action, varName),
    `    Wait Until Element Is Visible    \${${varName}}    timeout=10s`,
    `    ${action.keyword}    ${args}`,
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

/** "Click Export CSV" for actions, "Export CSV Should Be Enabled" for assertions. */
export function keywordName(action: RobotAction, varName: string): string {
  const title = titleCase(varName);
  if (action.suffix) return `${title} ${action.suffix}`;
  return `${action.verb ?? 'Use'} ${title}`;
}

/** Pad the variable column to 24 chars, the usual Robot alignment. */
function pad(varName: string): string {
  const width = Math.max(4, 24 - varName.length - 3);
  return ' '.repeat(width);
}

export function variableName(result: PickResult): string {
  const a = result.attributes;
  const source =
    DATA_ATTRS.map((k) => a[k]).find(Boolean) ??
    a['id'] ??
    a['name'] ??
    a['aria-label'] ??
    (result.text.split(/\s+/).slice(0, 3).join(' ') || undefined) ??
    // A spinner has none of the above but usually says what it is in a class.
    // ${LOADING_SPINNER} beats ${DIV} in a suite someone has to read.
    identifyingClass(a['class']) ??
    result.tagName;

  const cleaned = (source || result.tagName)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')     // drop punctuation and non-Latin marks
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return cleaned || `${result.tagName.toUpperCase()}_TARGET`;
}

/** The first class that names the thing rather than styling it. */
function identifyingClass(classAttr: string | undefined): string | undefined {
  return classAttr?.split(/\s+/).filter(Boolean).find((c) => !isUseless(c));
}

/** Words a tester would keep shouting: "Click Export CSV", not "Click Export Csv". */
const ACRONYMS = new Set(['csv', 'pdf', 'url', 'id', 'api', 'ok', 'sms', 'otp', 'qr', 'ui', 'html', 'xml', 'json']);

function titleCase(varName: string): string {
  return varName
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
