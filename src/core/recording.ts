/**
 * A recorded flow → a Robot Framework suite.
 *
 * The shape matters as much as the correctness. A recorder that emits one long
 * linear test case produces something a tester reads once and rewrites by hand,
 * which defeats the point. So every step becomes its own keyword — the same
 * Page-Object-ish block the single-element export already produces — and the
 * test case is the short, readable list of those keywords.
 *
 * Two things are deduplicated on the way out:
 *   - locators, so clicking the same button twice defines one variable;
 *   - keywords, so it also defines one keyword.
 * Names that collide while pointing at different things get a numeric suffix
 * rather than silently overwriting each other.
 */
import type { PickResult } from './types';
import {
  frameVarNames,
  keywordName,
  robotActionsFor,
  toRobotLocator,
  variableName,
  type RobotAction,
} from './robot';

/**
 * How long a keyword waits for its own element. Fixed on purpose: the flow wait
 * in the test case is what absorbs a slow request, so this only covers the gap
 * between the page settling and the element being interactable.
 */
const READY_TIMEOUT_S = 10;

/** `${NAME}` without fighting template-literal escaping at every call site. */
const v = (name: string): string => `\${${name}}`;

export type WaitKind =
  | 'none'
  | 'visible'
  | 'enabled'
  | 'not-visible'
  | 'contains'
  | 'location'
  | 'sleep';

/** The keyword each wait renders as. `none` renders nothing at all. */
const WAIT_KEYWORDS: Record<Exclude<WaitKind, 'none' | 'sleep' | 'location'>, string> = {
  visible: 'Wait Until Element Is Visible',
  enabled: 'Wait Until Element Is Enabled',
  'not-visible': 'Wait Until Element Is Not Visible',
  contains: 'Wait Until Page Contains Element',
};

/** What the panel's dropdown shows. Sleep is last and carries its warning. */
export const WAIT_LABELS: Record<WaitKind, string> = {
  none: 'no extra wait',
  visible: 'Wait Until Element Is Visible',
  enabled: 'Wait Until Element Is Enabled',
  'not-visible': 'Wait Until Element Is Not Visible',
  contains: 'Wait Until Page Contains Element',
  location: 'Wait Until Location Contains',
  sleep: '⚠ Sleep',
};

export const WAIT_ORDER: WaitKind[] = [
  'visible', 'enabled', 'not-visible', 'contains', 'location', 'none', 'sleep',
];

export interface WaitSpec {
  kind: WaitKind;
  /** The element to wait on — often NOT the step's own target (a spinner, say). */
  target?: PickResult;
  timeoutS: number;
  /** `sleep` only. */
  seconds?: number;
  /** `location` only. */
  urlFragment?: string;
  /**
   * Why the recorder chose this. Shown in the panel so the choice is teachable,
   * never written into the generated suite.
   */
  reason: string;
  /**
   * Still the fallback guess — the page had not settled when the next action
   * arrived. Refined in place once the observer catches up, unless the user has
   * edited it by then.
   */
  provisional?: boolean;
}

export type StepKind = 'click' | 'input' | 'select' | 'check' | 'assert' | 'navigate';

export interface RecordedStep {
  id: string;
  kind: StepKind;
  target: PickResult;
  /** Typed text, selected label, expected value — or the URL for `navigate`. */
  value?: string;
  /** SeleniumLibrary keyword. Defaults to the primary from robotActionsFor(). */
  keyword?: string;
  wait: WaitSpec;
  at: number;
}

export interface Recording {
  active: boolean;
  startedAt: number;
  startUrl: string;
  steps: RecordedStep[];
  /** Test case name. Seeded from the page title, edited in the panel. */
  name?: string;
  /** [Documentation] for the test case. Seeded with where and when. */
  doc?: string;
  /**
   * Where the panel sits and whether it is rolled up. Not part of the test —
   * it rides along here because this is the one object that survives a
   * navigation, and a panel that jumps back over the page on every page load
   * is worse than one that cannot be moved at all.
   */
  ui?: PanelPlacement;
}

export interface PanelPlacement {
  /** Viewport coordinates of the top-left corner. Absent means bottom-left. */
  x?: number;
  y?: number;
  collapsed?: boolean;
}

export const emptyRecording = (startUrl = ''): Recording => ({
  active: false,
  startedAt: 0,
  startUrl,
  steps: [],
});

/** The action a step renders as, honouring the keyword chosen in the panel. */
export function actionForStep(step: RecordedStep): RobotAction {
  const actions = robotActionsFor(step.target);
  return actions.find((a) => a.keyword === step.keyword) ?? actions[0]!;
}

// ── Name tables ──────────────────────────────────────────────────────────────

/**
 * One variable per distinct locator. Two steps on the same element share it;
 * two different elements that want the same name get _2, _3.
 */
class Symbols {
  private byLocator = new Map<string, string>();
  private taken = new Set<string>(RESERVED_VARS.map(normalizeVar));
  readonly rows: Array<{ name: string; value: string; note: string }> = [];

  forTarget(target: PickResult): string {
    const locator = toRobotLocator(target);
    const existing = this.byLocator.get(locator.value);
    if (existing) return existing;

    const name = this.claim(variableName(target));
    this.byLocator.set(locator.value, name);
    this.rows.push({ name, value: locator.value, note: locator.note });
    return name;
  }

  /** A literal value rather than a locator — the radio group name, the start URL. */
  plain(base: string, value: string, note = ''): string {
    const key = `plain:${base}:${value}`;
    const existing = this.byLocator.get(key);
    if (existing) return existing;

    const name = this.claim(base);
    this.byLocator.set(key, name);
    this.rows.push({ name, value, note });
    return name;
  }

  private claim(base: string): string {
    if (!this.taken.has(normalizeVar(base))) {
      this.taken.add(normalizeVar(base));
      return base;
    }
    let n = 2;
    while (this.taken.has(normalizeVar(`${base}_${n}`))) n += 1;
    const name = `${base}_${n}`;
    this.taken.add(normalizeVar(name));
    return name;
  }
}

interface KeywordDef {
  name: string;
  args: string[];
  body: string[];
}

/**
 * Identical keywords collapse into one definition. A name that collides while
 * the body differs gets suffixed, because two keywords with the same name is a
 * suite that will not run.
 */
class Keywords {
  private byContent = new Map<string, string>();
  private taken = new Set<string>();
  readonly defs: KeywordDef[] = [];

  add(name: string, args: string[], body: string[]): string {
    const content = JSON.stringify([name, args, body]);
    const existing = this.byContent.get(content);
    if (existing) return existing;

    let final = name;
    if (this.taken.has(final)) {
      let n = 2;
      while (this.taken.has(`${name} ${n}`)) n += 1;
      final = `${name} ${n}`;
    }
    this.taken.add(final);
    this.byContent.set(content, final);
    this.defs.push({ name: final, args, body });
    return final;
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The frame variables for an element, declared once each in the suite. */
function frameVarsFor(target: PickResult, syms: Symbols): string[] {
  const { frames } = toRobotLocator(target);
  return frameVarNames(frames).map((name, i) =>
    syms.plain(name, frames[i]!, i === 0 ? 'Selenium needs Select Frame to reach inside' : ''),
  );
}

const framesKey = (target: PickResult): string => toRobotLocator(target).frames.join('|');

/**
 * Wrap lines in the Select Frame / Unselect Frame pair they need. One Unselect
 * is enough at any depth — it returns to the main frame, not one level up.
 */
function inFrames(lines: string[], target: PickResult, syms: Symbols): string[] {
  const names = frameVarsFor(target, syms);
  if (!names.length) return lines;
  return [...names.map((n) => `    Select Frame    ${v(n)}`), ...lines, '    Unselect Frame'];
}

function renderWait(wait: WaitSpec, syms: Symbols): string | null {
  switch (wait.kind) {
    case 'none':
      return null;
    case 'sleep':
      return `    Sleep    ${wait.seconds ?? 1}s`;
    case 'location':
      return `    Wait Until Location Contains    ${wait.urlFragment ?? '/'}    timeout=${wait.timeoutS}s`;
    default: {
      if (!wait.target) return null;
      return `    ${WAIT_KEYWORDS[wait.kind]}    ${v(syms.forTarget(wait.target))}    timeout=${wait.timeoutS}s`;
    }
  }
}

/**
 * `${TEXT}` becomes the argument `${arg_text}`.
 *
 * The prefix is not decoration. Robot matches variable names case-insensitively
 * and ignores underscores and spaces while doing it, so `${password}` and
 * `${PASSWORD}` are one variable — and a keyword taking `${password}` while its
 * locator lives in `${PASSWORD}` overwrites the locator with the typed value
 * the moment it is called. It parses, it looks right, and it fails at run time
 * with "Element 'hunter2' not visible", which is a long way from the cause.
 *
 * Every password field in the world would have hit this.
 */
function argName(placeholder: string): string {
  return `arg_${placeholder.replace(/^\$\{|\}$/g, '').toLowerCase()}`;
}

/** Robot's own comparison: case-insensitive, and underscores and spaces ignored. */
const normalizeVar = (name: string): string => name.toLowerCase().replace(/[\s_]/g, '');

/** Argument names are claimed up front so no locator can ever take one. */
const RESERVED_VARS = ['TEXT', 'PASSWORD', 'LABEL', 'EXPECTED', 'FILE_PATH'].map((n) =>
  argName(`\${${n}}`),
);

/**
 * A recorded value goes into a cell, where two spaces mean "next argument" and
 * `${` means "variable". Escape rather than rewrite: the whole point of
 * recording is that the test carries the data that was actually entered.
 */
function safeValue(value: string): string {
  if (!value) return '${EMPTY}';
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\$\{/g, '\\${')
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/ {2,}/g, (run) => '\\ '.repeat(run.length));
  // A cell also drops the spaces at either end of itself.
  return escaped.replace(/^ /, '\\ ').replace(/ $/, '\\ ');
}

/**
 * A wait about the element itself belongs inside its keyword; a wait about the
 * flow — a spinner clearing, a route changing — belongs in the test case, where
 * the reader is following the sequence. The split is also what lets a second
 * click on the same button reuse one keyword instead of spawning a near-copy of
 * it under a suffixed name.
 */
function isElementReadiness(wait: WaitSpec, target: PickResult): boolean {
  if (wait.kind !== 'visible' && wait.kind !== 'enabled') return false;
  return !!wait.target && toRobotLocator(wait.target).value === toRobotLocator(target).value;
}

interface RenderedStep {
  /** Flow-level waits, emitted in the test case ahead of the call. */
  pre: string[];
  /** The line that invokes the step's keyword. */
  call: string;
}

function renderStep(step: RecordedStep, syms: Symbols, kws: Keywords): RenderedStep {
  const wait = renderWait(step.wait, syms);

  if (step.kind === 'navigate') {
    const urlVar = syms.plain('URL', step.value ?? '', 'recorded navigation');
    return { pre: wait ? [wait] : [], call: `    Go To    ${v(urlVar)}` };
  }

  const action = actionForStep(step);
  // A flow wait moves out to the test case; the keyword always keeps a
  // readiness line of its own, because waiting out a spinner says nothing about
  // whether the thing you are about to click ever arrived. Holding that line
  // constant is also what lets a second click on the same button reuse the
  // keyword rather than fork a near-identical copy of it.
  const readiness = isElementReadiness(step.wait, step.target);
  const inKeyword = readiness
    ? wait
    : `    Wait Until Element Is Visible    ${v(syms.forTarget(step.target))}    timeout=${READY_TIMEOUT_S}s`;

  // A wait on something inside a frame cannot sit in the test case: there is no
  // current frame there. It comes back into the keyword, in its own Select
  // Frame block when it is not the frame the step itself acts in.
  const waitFramed = !readiness && wait && !!step.wait.target && framesKey(step.wait.target) !== '';
  const sameFrame = waitFramed && framesKey(step.wait.target!) === framesKey(step.target);
  const pre = wait && !readiness && !waitFramed ? [wait] : [];
  const framedWait = waitFramed && !sameFrame ? inFrames([wait!], step.wait.target!, syms) : [];

  if (!action.takesLocator) return renderRadioStep(step, action, syms, kws, inKeyword, pre, framedWait);

  const varName = syms.forTarget(step.target);
  const name = keywordName(action, varName);

  const args = action.argument ? [argName(action.argument)] : [];
  const callArgs = [v(varName), ...args.map((a) => v(a))].join('    ');
  const body = [
    ...framedWait,
    ...inFrames(
      [
        ...(waitFramed && sameFrame && wait ? [wait] : []),
        ...(inKeyword ? [inKeyword] : []),
        `    ${action.keyword}    ${callArgs}`,
      ],
      step.target,
      syms,
    ),
  ];

  const final = kws.add(name, args, body);
  const passed = action.argument ? `    ${safeValue(step.value ?? action.argument)}` : '';
  return { pre, call: `    ${final}${passed}` };
}

/**
 * Select Radio Button / Radio Button Should Be Set To take (group_name, value),
 * so there is no locator to bind — two literal variables instead.
 */
function renderRadioStep(
  step: RecordedStep,
  action: RobotAction,
  syms: Symbols,
  kws: Keywords,
  wait: string | null,
  pre: string[],
  framedWait: string[],
): RenderedStep {
  const base = variableName(step.target);
  const group = step.target.attributes['name'] ?? 'GROUP_NAME';
  const value = step.value ?? step.target.attributes['value'] ?? step.target.attributes['id'] ?? 'VALUE';

  const groupVar = syms.plain(`${base}_GROUP`, group, "radio group's name attribute");
  const valueVar = syms.plain(`${base}_VALUE`, value);

  const body = [
    ...framedWait,
    ...inFrames(
      [
        ...(wait ? [wait] : [`    Wait Until Page Contains Element    name:${group}    timeout=${step.wait.timeoutS}s`]),
        `    ${action.keyword}    ${v(groupVar)}    ${v(valueVar)}`,
      ],
      step.target,
      syms,
    ),
  ];
  const final = kws.add(keywordName(action, base), [], body);
  return { pre, call: `    ${final}` };
}

/** Pad a variable name out to the usual 24-character Robot column. */
function pad(name: string): string {
  return ' '.repeat(Math.max(4, 24 - name.length - 3));
}

export interface SuiteOptions {
  /** Fallback test case name, when the recording carries none. */
  name?: string;
  browser?: string;
}

/**
 * A test case name is a cell like any other: two spaces start a new one, and
 * leading or trailing space is dropped. Keep it on one line too — a name is a
 * heading, not a paragraph.
 */
function safeName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleaned || fallback;
}

/**
 * Documentation is prose, not test data: collapse the whitespace rather than
 * escaping it, because `\ \ ` in the middle of a sentence reads like a typo.
 * The `${` still has to go — a doc string is expanded like any other cell.
 */
function safeDoc(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/\$\{/g, '\\${')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where this came from, so nobody has to guess six months from now. */
export function defaultDoc(rec: Recording): string {
  const when = new Date(rec.startedAt || Date.now()).toISOString().slice(0, 10);
  return `Recorded from ${rec.startUrl || 'the page'} on ${when}.`;
}

export function toRobotSuite(rec: Recording, options: SuiteOptions = {}): string {
  const testName = safeName(rec.name ?? options.name ?? '', 'Recorded Flow');
  const doc = safeDoc(rec.doc || '') || safeDoc(defaultDoc(rec));
  const syms = new Symbols();
  const kws = new Keywords();

  // Names are handed out before anything renders, durable locators first.
  // Otherwise a label someone brushed past takes ${BUG_TYPE} simply by being
  // clicked earlier, and the button the test actually drives ends up as
  // ${BUG_TYPE_2}. Order of appearance is a worse claim than durability.
  const targets = rec.steps.flatMap((step) =>
    step.kind === 'navigate' ? [] : [step.target, ...(step.wait.target ? [step.wait.target] : [])],
  );
  for (const target of targets.filter((t) => !toRobotLocator(t).fragile)) syms.forTarget(target);

  // Rendered first: laying out the steps is what populates the name tables.
  const calls = rec.steps.flatMap((step) => {
    const rendered = renderStep(step, syms, kws);
    return [...rendered.pre, rendered.call];
  });

  const browserVar = syms.plain('BROWSER', options.browser ?? 'chrome');
  const startVar = syms.plain('START_URL', rec.startUrl || 'about:blank');

  const variables = syms.rows.map((row) => {
    const line = `${v(row.name)}${pad(row.name)}${row.value}`;
    return row.note ? `# ${row.note}\n${line}` : line;
  });

  const keywords = kws.defs.map((def) =>
    [
      def.name,
      ...(def.args.length ? [`    [Arguments]    ${def.args.map((a) => v(a)).join('    ')}`] : []),
      ...def.body,
    ].join('\n'),
  );

  return [
    '*** Settings ***',
    'Library           SeleniumLibrary',
    '',
    '*** Variables ***',
    ...variables,
    '',
    '*** Test Cases ***',
    testName,
    `    [Documentation]    ${doc}`,
    `    Open Browser    ${v(startVar)}    ${v(browserVar)}`,
    ...calls,
    '    [Teardown]    Close Browser',
    '',
    '*** Keywords ***',
    keywords.join('\n\n'),
    '',
  ].join('\n');
}
