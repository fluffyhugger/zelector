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

interface RobotAction {
  keyword: string;
  /** Extra argument column, e.g. the text to type. */
  argument?: string;
  verb: string;
  /**
   * Select Radio Button is the one keyword here that does NOT take a locator:
   * its signature is (group_name, value), where group_name is the radio group's
   * name attribute and value is the radio's id or value. Passing a locator
   * would fail at runtime, so it gets its own rendering path.
   */
  takesLocator: boolean;
}

/**
 * SeleniumLibrary has a keyword per element kind, and using the specific one
 * matters: Click Button also matches on the value attribute, Click Link on href
 * and link text, while Click Element only knows id and name.
 */
export function robotActionFor(result: PickResult): RobotAction {
  const tag = result.tagName;
  const type = (result.attributes['type'] ?? '').toLowerCase();

  const L = { takesLocator: true } as const;

  if (tag === 'select') return { ...L, keyword: 'Select From List By Label', argument: '${LABEL}', verb: 'Select' };
  if (tag === 'textarea') return { ...L, keyword: 'Input Text', argument: '${TEXT}', verb: 'Fill' };
  if (tag === 'a') return { ...L, keyword: 'Click Link', verb: 'Click' };
  if (tag === 'button') return { ...L, keyword: 'Click Button', verb: 'Click' };

  if (tag === 'input') {
    switch (type) {
      case 'password': return { ...L, keyword: 'Input Password', argument: '${PASSWORD}', verb: 'Fill' };
      case 'checkbox': return { ...L, keyword: 'Select Checkbox', verb: 'Check' };
      case 'radio': return { keyword: 'Select Radio Button', verb: 'Choose', takesLocator: false };
      case 'file': return { ...L, keyword: 'Choose File', argument: '${FILE_PATH}', verb: 'Upload' };
      case 'submit':
      case 'button':
      case 'reset': return { ...L, keyword: 'Click Button', verb: 'Click' };
      default: return { ...L, keyword: 'Input Text', argument: '${TEXT}', verb: 'Fill' };
    }
  }
  return { ...L, keyword: 'Click Element', verb: 'Click' };
}

export function toRobotCode(result: PickResult): string {
  const action = robotActionFor(result);
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
    `\${${varName}}${pad(varName)}${locator.value}`,
    '',
    '*** Keywords ***',
    `${action.verb} ${titleCase(varName)}`,
    `    [Documentation]    ${locator.note}`,
    `    Wait Until Element Is Visible    \${${varName}}    timeout=10s`,
    `    ${action.keyword}    ${args}`,
  ].join('\n');
}

/**
 * Select Radio Button(group_name, value) — both arguments are plain attribute
 * values, so there is no locator variable to define. The wait still needs one,
 * and name: is the only strategy guaranteed to find a member of the group.
 */
function renderRadioKeyword(result: PickResult, action: RobotAction): string {
  const group = result.attributes['name'] ?? '${GROUP_NAME}';
  const value = result.attributes['value'] ?? result.attributes['id'] ?? '${VALUE}';
  const varName = variableName(result);

  return [
    '*** Variables ***',
    `\${${varName}_GROUP}${pad(varName + '_GROUP')}${group}`,
    `\${${varName}_VALUE}${pad(varName + '_VALUE')}${value}`,
    '',
    '*** Keywords ***',
    `${action.verb} ${titleCase(varName)}`,
    `    [Documentation]    Select Radio Button takes the group name and the button's value — not a locator`,
    `    Wait Until Page Contains Element    name:${group}    timeout=10s`,
    `    ${action.keyword}    \${${varName}_GROUP}    \${${varName}_VALUE}`,
  ].join('\n');
}

/** Pad the variable column to 24 chars, the usual Robot alignment. */
function pad(varName: string): string {
  const width = Math.max(4, 24 - varName.length - 3);
  return ' '.repeat(width);
}

function variableName(result: PickResult): string {
  const a = result.attributes;
  const source =
    DATA_ATTRS.map((k) => a[k]).find(Boolean) ??
    a['id'] ??
    a['name'] ??
    a['aria-label'] ??
    result.text.split(/\s+/).slice(0, 3).join(' ') ??
    result.tagName;

  const cleaned = (source || result.tagName)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')     // drop punctuation and non-Latin marks
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return cleaned || `${result.tagName.toUpperCase()}_TARGET`;
}

function titleCase(varName: string): string {
  return varName
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
