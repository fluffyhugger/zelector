/**
 * Turns what someone does on a page into steps.
 *
 * Three things decide whether the output is usable:
 *
 *  1. WHAT is the target. A click lands on whatever span happens to be under
 *     the cursor; the step wants the button that contains it.
 *  2. HOW MANY steps. Raw events turn a six-step login into eighty. Keystrokes
 *     coalesce into one Input Text, and a click on a <label> becomes a step on
 *     the control it labels.
 *  3. WHAT TO WAIT FOR. Inferred from the observer, never from the clock.
 *     See observer.ts — this file only decides which wait the evidence implies.
 */
import type { PickResult } from '@/core/types';
import { toRobotLocator } from '@/core/robot';
import type { RecordedStep, Recording, StepKind, WaitSpec } from '@/core/recording';
import { deepElementFromPoint, describe } from './picker';
import { isOwnNode } from './ignore';
import { emptyChange, timeoutFor, watchPageChange, type PageChange, type Watch } from './observer';

/** How long a typing burst can pause before it is flushed as its own step. */
const TYPING_IDLE_MS = 700;

/** A click on a span inside a button is a click on the button. */
const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[onclick],[tabindex]';

export interface RecorderCallbacks {
  /** Steps changed — re-render the panel and push the new state upstream. */
  onChange(steps: RecordedStep[]): void;
  onStateChange(active: boolean): void;
}

let seq = 0;
const nextId = (): string => `s${Date.now().toString(36)}${(seq += 1).toString(36)}`;

export class Recorder {
  private active = false;
  private steps: RecordedStep[] = [];
  private startedAt = 0;
  private startUrl = '';
  private name = '';
  private doc = '';
  /**
   * The picker is open. Its click listener is registered after ours, so without
   * this the click that picks an element to assert on is also recorded as a
   * step — the flow grows a phantom click every time you add an assertion.
   */
  private suspended = false;
  private typing: { el: Element; target: PickResult; value: string } | null = null;
  private typingTimer = 0;
  /** A settled page change waiting for the step it should inform. */
  private pending: { forIndex: number; change: PageChange } | null = null;
  /** The window still open on the last action's aftermath. */
  private watch: Watch | null = null;

  constructor(private readonly callbacks: RecorderCallbacks) {}

  get isRecording(): boolean {
    return this.active;
  }

  /** Held while the picker owns the pointer. */
  setSuspended(suspended: boolean): void {
    if (suspended) this.flushTyping();
    this.suspended = suspended;
  }

  private get capturing(): boolean {
    return this.active && !this.suspended;
  }

  snapshot(): Recording {
    return {
      active: this.active,
      startedAt: this.startedAt,
      startUrl: this.startUrl,
      steps: this.steps,
      name: this.name,
      doc: this.doc,
    };
  }

  setName(name: string): void {
    this.name = name;
    this.emit();
  }

  setDoc(doc: string): void {
    this.doc = doc;
    this.emit();
  }

  /**
   * Pick the flow back up on a page that replaced the one it started on. The
   * click that navigated was recorded before this world was torn down, and its
   * aftermath — the navigation itself — belongs to the step not taken yet.
   */
  restore(recording: Recording): void {
    this.steps = recording.steps;
    this.startedAt = recording.startedAt;
    this.startUrl = recording.startUrl;
    this.name = recording.name ?? '';
    this.doc = recording.doc ?? '';
    if (this.steps.length) {
      this.pending = {
        forIndex: this.steps.length,
        change: { ...emptyChange(), url: location.href, elapsedMs: 1000 },
      };
    }
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    if (!this.startedAt) {
      this.startedAt = Date.now();
      this.startUrl = location.href;
      // The page title is the closest thing to a name for what is about to be
      // tested, and beats making everyone rename "Recorded Flow" by hand.
      this.name = this.name || titleCase(document.title);
    }
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('input', this.onInput, true);
    window.addEventListener('change', this.onChange, true);
    window.addEventListener('focusout', this.onFocusOut, true);
    this.callbacks.onStateChange(true);
    this.emit();
  }

  stop(): void {
    if (!this.active) return;
    this.flushTyping();
    this.watch?.settle();
    this.watch = null;
    this.active = false;
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('input', this.onInput, true);
    window.removeEventListener('change', this.onChange, true);
    window.removeEventListener('focusout', this.onFocusOut, true);
    this.callbacks.onStateChange(false);
  }

  clear(): void {
    this.steps = [];
    this.pending = null;
    this.watch = null;
    this.emit();
  }

  removeStep(id: string): void {
    this.steps = this.steps.filter((s) => s.id !== id);
    this.emit();
  }

  /** A wait the user chose by hand is never overwritten by the observer. */
  updateWait(id: string, wait: Partial<WaitSpec>): void {
    const step = this.steps.find((s) => s.id === id);
    if (!step) return;
    step.wait = { ...step.wait, ...wait, provisional: false };
    this.emit();
  }

  updateKeyword(id: string, keyword: string): void {
    const step = this.steps.find((s) => s.id === id);
    if (!step) return;
    step.keyword = keyword;
    this.emit();
  }

  /**
   * Steps captured by a frame below this one. Upserted by id and re-ordered by
   * time, because a frame refines a step's wait after the fact and sends it
   * again — and because two frames interleave.
   */
  acceptForeignSteps(incoming: RecordedStep[]): void {
    let changed = false;
    for (const step of incoming) {
      const at = this.steps.findIndex((s) => s.id === step.id);
      if (at === -1) {
        this.steps.push(step);
        changed = true;
      } else if (JSON.stringify(this.steps[at]) !== JSON.stringify(step)) {
        this.steps[at] = step;
        changed = true;
      }
    }
    if (!changed) return;
    this.steps.sort((a, b) => a.at - b.at);
    this.emit();
  }

  /** An assertion chosen through the picker, inserted at the end of the flow. */
  addAssert(target: PickResult, keyword: string): void {
    this.push({ kind: 'assert', target, keyword });
  }

  /** A navigation the user performed by hand rather than by clicking. */
  noteNavigation(url: string): void {
    const last = this.steps[this.steps.length - 1];
    // A click that navigates already carries the URL in its wait; do not double up.
    if (last?.wait.kind === 'location') return;
    this.push({ kind: 'navigate', target: describe(document.documentElement), value: url });
  }

  // ── Capture ────────────────────────────────────────────────────────────────

  private onClick = (event: MouseEvent): void => {
    if (!this.capturing || isOwnNode(event.target)) return;
    const raw = deepElementFromPoint(event.clientX, event.clientY)
      ?? (event.target instanceof Element ? event.target : null);
    if (!raw) return;

    const el = resolveTarget(raw);
    this.flushTyping(el);

    // Clicking into a field is not an action, it is aiming. The typing that
    // follows is the step — and recording the click as well produced an
    // Input Text with no value to type, right before the real one.
    if (isTextEntry(el) || el instanceof HTMLSelectElement) return;

    const kind: StepKind = isToggle(el) ? 'check' : 'click';
    // A click on a checkbox also fires change; the change handler defers to this.
    this.push({ kind, target: describe(el) });
  };

  private onInput = (event: Event): void => {
    if (!this.capturing || isOwnNode(event.target)) return;
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (isToggle(el)) return;

    if (this.typing && this.typing.el !== el) this.flushTyping();
    this.typing = { el, target: this.typing?.el === el ? this.typing.target : describe(el), value: el.value };

    clearTimeout(this.typingTimer);
    this.typingTimer = window.setTimeout(() => this.flushTyping(), TYPING_IDLE_MS);
  };

  private onChange = (event: Event): void => {
    if (!this.capturing || isOwnNode(event.target)) return;
    const el = event.target;
    if (el instanceof HTMLSelectElement) {
      this.flushTyping();
      const label = el.selectedOptions[0]?.label ?? el.value;
      this.push({ kind: 'select', target: describe(el), value: label });
      return;
    }
    if (el instanceof HTMLInputElement && isToggle(el)) {
      // The click handler already recorded this one.
      const last = this.steps[this.steps.length - 1];
      if (last?.kind === 'check' && Date.now() - last.at < 400) return;
      this.push({ kind: 'check', target: describe(el) });
      return;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) this.flushTyping();
  };

  private onFocusOut = (): void => {
    if (this.capturing) this.flushTyping();
  };

  /** A typing burst becomes one Input Text with the final value. */
  private flushTyping(nextTarget?: Element): void {
    clearTimeout(this.typingTimer);
    const typing = this.typing;
    if (!typing) return;
    if (nextTarget && nextTarget === typing.el) return;
    this.typing = null;
    if (!typing.value) return;
    this.push({ kind: 'input', target: typing.target, value: typing.value });
  }

  // ── Step construction ──────────────────────────────────────────────────────

  private push(partial: { kind: StepKind; target: PickResult; value?: string; keyword?: string }): void {
    const index = this.steps.length;
    // Close the window on the previous action first. Whatever the page does
    // from here belongs to this step, not the one before it.
    const change = this.watch
      ? this.watch.settle()
      : this.pending?.forIndex === index
        ? this.pending.change
        : null;
    this.watch = null;
    this.pending = null;

    const step: RecordedStep = {
      id: nextId(),
      kind: partial.kind,
      target: partial.target,
      ...(partial.value !== undefined ? { value: partial.value } : {}),
      ...(partial.keyword !== undefined ? { keyword: partial.keyword } : {}),
      wait: change ? inferWait(change, partial.target) : provisionalWait(partial.target),
      at: Date.now(),
    };
    this.steps.push(step);
    this.emit();

    // Assertions do not drive the page; watching after one would attribute the
    // previous action's aftermath to the wrong step.
    if (partial.kind !== 'assert') this.watchFor(this.steps.length);
  }

  /**
   * Watch the page on behalf of the step at `index` — the one not taken yet.
   * Either the page goes quiet first and the result waits here, or the user
   * acts first and push() settles the window itself.
   */
  private watchFor(index: number): void {
    this.watch = watchPageChange((change) => {
      this.watch = null;
      this.pending = { forIndex: index, change };
    });
  }

  private emit(): void {
    this.callbacks.onChange(this.steps);
  }
}

// ── Target resolution ────────────────────────────────────────────────────────

/** "Checkout — Acme Store" → "Checkout Acme Store", a usable test case name. */
function titleCase(title: string): string {
  const cleaned = title.replace(/[|—–·].*$/, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(/\s+/)
    .slice(0, 6)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function isToggle(el: Element): boolean {
  return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
}

/** Something you type into, rather than press. */
function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !isToggle(el) && !BUTTON_INPUTS.has(el.type);
}

const BUTTON_INPUTS = new Set(['button', 'submit', 'reset', 'file', 'image']);

/**
 * The element a tester would have written the locator for: the nearest
 * interactive ancestor, and for a <label>, the control it points at.
 */
function resolveTarget(el: Element): Element {
  const interactive = el.closest(INTERACTIVE) ?? el;
  if (interactive instanceof HTMLLabelElement) {
    const control = interactive.control ?? interactive.querySelector('input,select,textarea');
    if (control instanceof Element) return control;
  }
  return interactive;
}

// ── Wait inference ───────────────────────────────────────────────────────────

/** Before the page has been watched: see the thing before touching it. */
function provisionalWait(target: PickResult): WaitSpec {
  return {
    kind: 'visible',
    target,
    timeoutS: 10,
    reason: 'default — the page was still settling',
    provisional: true,
  };
}

const sameElement = (a: PickResult, b: PickResult): boolean =>
  toRobotLocator(a).value === toRobotLocator(b).value;

/** Biggest thing on screen wins — a modal beats the toast in its corner. */
const mostProminent = (list: PickResult[]): PickResult | undefined =>
  [...list].sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];

export function inferWait(change: PageChange, ownTarget: PickResult): WaitSpec {
  const timeoutS = timeoutFor(change);
  const requestNote = change.requests.length
    ? `${change.requests[0]!.method} ${short(change.requests[0]!.url)} (${Math.round(change.requests[0]!.durationMs)}ms)`
    : null;

  // "/" matches every URL there is, so a wait on it asserts nothing and passes
  // instantly — worse than no wait, because it looks like one.
  const path = change.url ? safePath(change.url) : '';
  if (path && path !== '/') {
    return {
      kind: 'location',
      timeoutS,
      urlFragment: path,
      reason: `the page navigated to ${path}`,
    };
  }

  // A spinner that came and went is exactly what the next step has to outlast.
  const spinner = mostProminent(change.transient);
  if (spinner) {
    return {
      kind: 'not-visible',
      target: spinner,
      timeoutS,
      reason: requestNote
        ? `after ${requestNote}, <${spinner.tagName}> appeared then went away`
        : `<${spinner.tagName}> appeared then went away`,
    };
  }

  const appeared = mostProminent(change.appeared);
  if (appeared) {
    // If the thing that appeared is what this step touches, wait on it directly
    // rather than on some container around it.
    const target = sameElement(appeared, ownTarget) ? ownTarget : appeared;
    return {
      kind: 'visible',
      target,
      timeoutS,
      reason: requestNote
        ? `after ${requestNote}, <${target.tagName}> appeared`
        : `<${target.tagName}> appeared`,
    };
  }

  if (requestNote) {
    return {
      kind: 'visible',
      target: ownTarget,
      timeoutS,
      reason: `${requestNote} fired, but nothing new rendered`,
    };
  }

  // Never infer a bare 'none': the page not reacting says nothing about whether
  // the next target is on screen yet. 'none' stays something the user chooses.
  return {
    kind: 'visible',
    target: ownTarget,
    timeoutS,
    reason: 'the page did not react — just checking the target is there',
  };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function short(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.length > 40 ? `${u.pathname.slice(0, 40)}…` : u.pathname;
  } catch {
    return url.slice(0, 40);
  }
}

export { emptyChange };
