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
import type {
  DialogStep,
  PanelPlacement,
  RecordedStep,
  Recording,
  StepKind,
  WaitSpec,
} from '@/core/recording';
import { deepElementFromPoint, describe } from './picker';
import { onDialog } from './hooks';
import { isNotPageContent } from './ignore';
import { emptyChange, timeoutFor, watchPageChange, type PageChange, type Watch } from './observer';

/** How long a typing burst can pause before it is flushed as its own step. */
const TYPING_IDLE_MS = 700;

/**
 * A click on a span inside a button is a click on the button.
 *
 * The option roles matter as much as the button ones. Every headless combobox
 * — Headless UI, Radix, MUI — renders its list inside the same wrapper as the
 * control that opens it, so an option with no role of its own walks up past the
 * list and lands on that control. The step then reads as a second click on the
 * dropdown rather than a choice made inside it.
 */
const INTERACTIVE = [
  'a', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
  '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
  '[role="option"]', '[role="treeitem"]', '[role="switch"]', '[role="combobox"]',
  '[onclick]', '[tabindex]',
].join(',');

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
  private ui: PanelPlacement = {};
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
  /** Unsubscribes the dialog listener when recording stops. */
  private offDialog: (() => void) | null = null;
  /** The window still open on the last action's aftermath. */
  private watch: Watch | null = null;
  /**
   * What was under the pointer when it went down — which is what the person
   * aimed at. By the time the click event arrives the page may have moved
   * something else under the cursor.
   */
  private pressed: { el: Element; x: number; y: number; at: number } | null = null;
  /**
   * The element the last click resolved to. Kept because a <label> forwards its
   * click to its control, and the forwarded event carries no coordinates — so
   * the second arrival resolves to the control while the first resolved to the
   * label, and the dedup in push(), which compares targets, sees two different
   * elements and keeps both.
   */
  private lastClicked: { el: Element; at: number } | null = null;
  /** When a drag finished, so the click it drags behind it can be ignored. */
  private dragged = 0;
  /** Where the pointer is now, and since when. */
  private hovering: { el: Element; since: number } | null = null;
  /**
   * The last thing the pointer actually rested on before moving off it.
   *
   * Not the same as `hovering`: to click a menu item the pointer has to cross
   * it first, so by the time the click arrives the current hover is the target
   * itself. What opened the menu is the one before that.
   */
  private lastRested: Element | null = null;
  /**
   * What the previous click acted on.
   *
   * The pointer necessarily rests on a thing it just clicked, so without this
   * every panel opened by a click looks like a panel opened by a hover, and
   * every step after one gains a Mouse Over that does nothing.
   */
  private previousClick: Element | null = null;

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
      ui: this.ui,
    };
  }

  setUi(ui: PanelPlacement): void {
    this.ui = { ...this.ui, ...ui };
    this.emit();
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
    this.ui = recording.ui ?? {};
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

    // Watch from the moment recording starts, not from the first step. Without
    // this the opening action has nothing to go on and always came out as
    // "the page was still settling" — and a hover that opens a menu could never
    // be the first thing recorded, because the evidence for it had not started
    // being collected. Skipped when a navigation has already left an answer
    // waiting.
    if (!this.pending) this.watchFor(this.steps.length);
    // A dialog blocks the page, so this fires after it has been answered and
    // before the page acts on the answer — which lands the step immediately
    // after the click that raised it, with no ordering work needed.
    this.offDialog = onDialog((event) => {
      if (!this.capturing) return;
      const dialog: DialogStep = {
        kind: event.kind,
        message: event.message,
        accepted: event.accepted,
        ...(event.text === undefined ? {} : { text: event.text }),
      };
      this.push({ kind: 'dialog', target: describe(document.documentElement), dialog });
    });
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointerover', this.onPointerOver, true);
    window.addEventListener('keydown', this.onKeyDown, true);
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
    this.offDialog?.();
    this.offDialog = null;
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointerover', this.onPointerOver, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
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

  /**
   * An action begins when the pointer goes down, not when the click lands.
   *
   * Pressing a date field focuses it, and focusing it opens its calendar — all
   * before the click event arrives. Closing the window at click time therefore
   * credited the calendar to whatever came *before*, and the step that opens it
   * was handed "wait until the calendar is showing" as its precondition. So the
   * window closes here instead, at the moment the page stops reacting to the
   * last action and starts reacting to this one.
   */
  private onPointerDown = (event: PointerEvent): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;

    // Aim is taken here as well. A dropdown that opens on mousedown has its
    // menu under the cursor before the click lands, so hit-testing then
    // returns an option — and the step that opened the list is recorded as a
    // second click on something inside it.
    const el = deepElementFromPoint(event.clientX, event.clientY)
      ?? (event.target instanceof Element ? event.target : null);
    this.pressed = el ? { el, x: event.clientX, y: event.clientY, at: Date.now() } : null;

    if (!this.watch) return;
    this.pending = { forIndex: this.steps.length, change: this.watch.settle() };
    this.watch = null;
  };

  /**
   * Keys that do something rather than say something.
   *
   * Typing is already covered by the input event, so only the presses that act
   * on their own are steps: Enter submitting a search, Escape closing a menu.
   * Everything else is either a character on its way into a field or a
   * navigation key that the recording does not need to reproduce.
   */
  /**
   * A press that travels before it is let go is a drag, not a click.
   *
   * Native drag-and-drop and every JavaScript implementation of it agree on
   * this much: the pointer goes down on one thing and comes up on another.
   * Recording it as a click on whichever of the two the browser decides to fire
   * a click event over is worse than recording nothing, which is what happened
   * before.
   */
  private onPointerUp = (event: PointerEvent): void => {
    const pressed = this.pressed;
    if (!this.capturing || !pressed || isNotPageContent(event.target)) return;

    const travelled = Math.abs(pressed.x - event.clientX) + Math.abs(pressed.y - event.clientY);
    if (travelled < DRAG_THRESHOLD) return;

    const landed = deepElementFromPoint(event.clientX, event.clientY);
    if (!landed || isNotPageContent(landed) || landed === pressed.el) return;

    this.pressed = null;   // the click that follows belongs to this gesture
    this.dragged = Date.now();
    this.push({
      kind: 'drag',
      target: describe(resolveTarget(pressed.el)),
      dropTarget: describe(resolveTarget(landed)),
    });
  };

  private onPointerOver = (event: PointerEvent): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const el = event.target instanceof Element ? resolveTarget(event.target) : null;
    if (!el || el === this.hovering?.el) return;

    const leaving = this.hovering;
    if (leaving && Date.now() - leaving.since >= HOVER_DWELL) this.lastRested = leaving.el;
    this.hovering = { el, since: Date.now() };
  };

  /**
   * Did the pointer resting somewhere put this within reach?
   *
   * Hovering is impossible to record on its own: the pointer crosses a hundred
   * things on the way anywhere and almost none of them matter. What makes a
   * hover a step is the consequence — a menu opened, and the next click landed
   * inside it. So the test is exactly that, and nothing is recorded for a
   * pointer that merely passed over something on its way to a button that was
   * already there.
   */
  private hoverThatRevealed(el: Element, change: PageChange | null): Element | null {
    const rested = this.lastRested;
    if (!rested || !change || rested === el || rested.contains(el)) return null;
    // It opened when it was clicked, not when it was hovered.
    if (rested === this.previousClick) return null;
    const revealed = change.appearedEls.some((appeared) => appeared.contains(el));
    return revealed ? rested : null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const key = ACTING_KEYS[event.key];
    if (!key || event.altKey || event.ctrlKey || event.metaKey) return;

    const el = event.target instanceof Element ? event.target : document.activeElement;
    if (!el || isNotPageContent(el)) return;

    // Enter in a field submits what was typed, so the typing is its own step
    // and has to land first.
    this.flushTyping();
    this.push({ kind: 'key', target: describe(el), value: key });
  };

  private onClick = (event: MouseEvent): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;

    // A drag ends with a click event over one end or the other. It is not a
    // click, and the drag has already been recorded.
    if (Date.now() - this.dragged < 400) return;

    const fromEvent = event.target instanceof Element ? event.target : null;
    // A click from the keyboard reports 0,0, and whatever sits in the corner of
    // the viewport is not what was activated. Only trust the point when there
    // is a real pointer behind it — and prefer where that pointer went down.
    const pointed = event.clientX || event.clientY
      ? this.aimedAt(event) ?? deepElementFromPoint(event.clientX, event.clientY)
      : null;
    const raw = pointed ?? fromEvent;
    if (!raw || isNotPageContent(raw)) return;

    const el = resolveTarget(raw);

    // The same click, arriving a second time on the other side of a <label>.
    if (this.reachedThroughLabel(el)) return;
    this.previousClick = this.lastClicked?.el ?? null;
    this.lastClicked = { el, at: Date.now() };

    this.flushTyping(el);

    if (el instanceof HTMLSelectElement) return; // the change event is the step

    // Clicking a field is usually aiming rather than acting, and recording it
    // as well used to produce an Input Text with nothing to type right before
    // the real one. But it is not always aiming: a date input opens a picker,
    // and dropping that click left the recording clicking a day in a calendar
    // that had never been opened. So the click is kept, and thrown away later
    // if typing into the same field turns out to follow it.
    if (isTextEntry(el)) {
      this.push({ kind: 'click', target: describe(el), keyword: 'Click Element' });
      return;
    }

    // Clicking the whitespace of a form or a section is not a step. Worse, it
    // replays as a click on that container's centre — which is somewhere else
    // entirely, and on the page this was found on, landed in a date field and
    // left a calendar open over everything the rest of the flow needed.
    if (STRUCTURAL.has(el.tagName)) return;

    this.recordHoverBefore(el);

    const kind: StepKind = isToggle(el) ? 'check' : 'click';
    // A click on a checkbox also fires change; the change handler defers to this.
    this.push({ kind, target: describe(el), ...toggleKeyword(el) });
  };

  private onInput = (event: Event): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    // Only the ones you actually type into. A file input fires input events too,
    // and its value is the browser's `C:\fakepath\name` placeholder — which is
    // not a path, not what was typed, and not a step.
    if (!isTextEntry(el)) return;

    if (this.typing && this.typing.el !== el) this.flushTyping();
    this.typing = { el, target: this.typing?.el === el ? this.typing.target : describe(el), value: el.value };

    clearTimeout(this.typingTimer);
    this.typingTimer = window.setTimeout(() => this.flushTyping(), TYPING_IDLE_MS);
  };

  /**
   * Was this control just recorded by way of its <label>?
   *
   * Clicking a label reaches the control twice over: the click is forwarded to
   * it, and a change event follows. The label is already the step — it was kept
   * because the control beneath it cannot be clicked — so both of those are the
   * same action arriving again, and neither is a step of its own. Merging them
   * would be wrong too: Select Checkbox aimed at a <label> does not run.
   */
  private reachedThroughLabel(el: Element): boolean {
    const clicked = this.lastClicked;
    return (
      !!clicked &&
      Date.now() - clicked.at < 400 &&
      clicked.el instanceof HTMLLabelElement &&
      clicked.el.control === el
    );
  }

  private onChange = (event: Event): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const el = event.target;
    if (el instanceof HTMLSelectElement) {
      this.flushTyping();
      const label = el.selectedOptions[0]?.label ?? el.value;
      this.push({ kind: 'select', target: describe(el), value: label });
      return;
    }
    if (el instanceof HTMLInputElement && isToggle(el)) {
      if (this.reachedThroughLabel(el)) return;
      const last = this.steps[this.steps.length - 1];
      if (last?.kind === 'check' && Date.now() - last.at < 400) {
        // The click handler already recorded this one — but a click routed
        // through a <label> reaches us before the control has flipped, so what
        // it wrote down is the state on the way in. change fires afterwards and
        // knows which way it went; take its word for it.
        const settled = toggleKeyword(el).keyword;
        if (settled && last.keyword !== settled) {
          last.keyword = settled;
          this.emit();
        }
        return;
      }
      this.push({ kind: 'check', target: describe(el), ...toggleKeyword(el) });
      return;
    }
    // A file input's click was already recorded; what the change adds is which
    // file was picked, which is worth writing down even though the path is not
    // available to record.
    if (el instanceof HTMLInputElement && el.type === 'file') {
      const chosen = el.files?.[0]?.name;
      if (!chosen) return;
      const target = describe(el);
      const last = this.steps[this.steps.length - 1];

      // Opening the picker was recorded as a click, so this only adds which
      // file came back. Dropped onto the input instead, there is no click to
      // add it to and the choice is the whole step.
      if (last && sameElement(last.target, target)) {
        last.value = chosen;
        this.emit();
        return;
      }
      this.push({ kind: 'click', target, value: chosen });
      return;
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) this.flushTyping();
  };

  /** The press this click came from, if the pointer did not travel meanwhile. */
  private aimedAt(event: MouseEvent): Element | null {
    const pressed = this.pressed;
    this.pressed = null;
    if (!pressed || Date.now() - pressed.at > 2000) return null;
    const moved = Math.abs(pressed.x - event.clientX) + Math.abs(pressed.y - event.clientY);
    return moved <= 4 && pressed.el.isConnected ? pressed.el : null;
  }

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

    const last = this.steps[this.steps.length - 1];

    // Still the same field, and nothing has happened in between — anything else
    // would have pushed a step of its own. This is one person filling in one
    // box, however many times they paused to think. Otherwise a slow typist
    // gets Fill Username "s", then "standar", then "standard_user", all of
    // which replay as a full retype of the field.
    if (last?.kind === 'input' && sameElement(last.target, typing.target)) {
      last.value = typing.value;
      last.at = Date.now();
      this.emit();
      return;
    }

    // The click that put the caret here was aiming after all.
    if (last?.kind === 'click' && sameElement(last.target, typing.target)) {
      this.steps.pop();
    }
    this.push({ kind: 'input', target: typing.target, value: typing.value });
  }

  // ── Step construction ──────────────────────────────────────────────────────

  /**
   * The step that made the next one reachable, inserted in front of it.
   *
   * Asked before the click is pushed, because the window it consults is the one
   * push() is about to close — after that it is gone.
   */
  private recordHoverBefore(el: Element): void {
    const settled = this.watch ? this.watch.settle() : this.pending?.change ?? null;
    if (this.watch) {
      // Settling it here rather than in push() so both see the same answer.
      this.pending = { forIndex: this.steps.length, change: settled! };
      this.watch = null;
    }
    const opener = this.hoverThatRevealed(el, settled);
    if (!opener) return;
    this.lastRested = null;
    this.push({ kind: 'hover', target: describe(opener) });
  }

  private push(partial: {
    kind: StepKind;
    target: PickResult;
    value?: string;
    keyword?: string;
    dialog?: DialogStep;
    dropTarget?: PickResult;
  }): void {
    // A click on a <label> is delivered again, forwarded to the control, and a
    // toggle reached that way reports the state on the way in before it reports
    // the state it settled on. Either way it is one action, so the second
    // arrival corrects the first rather than adding to it.
    const previous = this.steps[this.steps.length - 1];
    if (
      previous &&
      (partial.kind === 'click' || partial.kind === 'check') &&
      previous.kind === partial.kind &&
      Date.now() - previous.at < 400 &&
      sameElement(previous.target, partial.target)
    ) {
      if (partial.keyword) previous.keyword = partial.keyword;
      previous.at = Date.now();
      this.emit();
      return;
    }

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
      ...(partial.dialog !== undefined ? { dialog: partial.dialog } : {}),
      ...(partial.dropTarget !== undefined ? { dropTarget: partial.dropTarget } : {}),
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

/**
 * Which keyword a toggle became, rather than which one it usually is.
 *
 * Select Checkbox was emitted for every click on one, so clicking a box on and
 * then off again recorded as checking it twice. It still passes — Select
 * Checkbox on an already-checked box does nothing — but it stops describing
 * what happened, and a recording that quietly disagrees with the session it
 * came from is not worth having.
 *
 * Checkedness is set before the click event is dispatched, so this reads the
 * state the user is looking at. A radio needs no such care: clicking one always
 * selects it and never clears it.
 */
function toggleKeyword(el: Element): { keyword?: string } {
  if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') return {};
  return { keyword: el.checked ? 'Select Checkbox' : 'Unselect Checkbox' };
}

/**
 * Containers a click never really means. Reached only when nothing interactive
 * was found above or below the pointer, so a real widget built out of one of
 * these is unaffected — it would have been resolved before getting here.
 */
const STRUCTURAL = new Set([
  'HTML', 'BODY', 'FORM', 'MAIN', 'SECTION', 'ARTICLE', 'ASIDE',
  'HEADER', 'FOOTER', 'NAV', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TR',
]);

/** Is this element the thing a click at its own centre would land on? */
function isHitTestable(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}

/** Far enough that nobody meant it as a click. */
const DRAG_THRESHOLD = 12;

/** Long enough to be resting rather than passing through. */
const HOVER_DWELL = 150;

/** Selenium's names for the keys worth recording. */
const ACTING_KEYS: Record<string, string> = {
  Enter: 'RETURN',
  Escape: 'ESCAPE',
};

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
  const interactive = el.closest(INTERACTIVE);
  if (interactive) {
    if (interactive instanceof HTMLLabelElement) {
      const control = interactive.control ?? interactive.querySelector('input,select,textarea');
      // Only hand over to the control if the control can actually be clicked.
      // Every custom checkbox — Bootstrap, Tailwind, Material — leaves the real
      // input underneath its label, so Select Checkbox aimed at the input gets
      // "element click intercepted" while the person recording clicked the
      // label and saw it work.
      if (control instanceof HTMLElement && isHitTestable(control)) return control;
    }
    return interactive;
  }

  // A form or a section is not a wrapper worth looking inside. Descending from
  // one finds whichever single control it happens to contain, so clicking the
  // whitespace of a form with one button in it records a click on that button.
  if (STRUCTURAL.has(el.tagName)) return el;

  // Nothing interactive above. A wrapper holding exactly one control is that
  // control — Angular Material's form field is a stack of presentational divs
  // around a single mat-select, and clicking the padding is how everyone opens
  // it. Without this, a session on that page records a dozen steps against
  // `class:mat-mdc-form-field-infix` and none against the thing it wraps.
  const inside = [...el.querySelectorAll(INTERACTIVE)];
  // Only the outermost ones: a control with something focusable inside it is
  // still one control.
  const outermost = inside.filter((c) => !inside.some((o) => o !== c && o.contains(c)));
  // And a <label> sitting next to the control describes it rather than competing
  // with it — Material's form field holds exactly that pair, which is why
  // requiring a single candidate never fired there.
  const controls = outermost.filter((c) => !(c instanceof HTMLLabelElement));
  return controls.length === 1 && controls[0] ? controls[0] : el;
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

/**
 * Biggest thing on screen wins — a modal beats the toast in its corner — but
 * only among the ones worth waiting on.
 *
 * A wait is only as good as its locator, and the largest element that appeared
 * is often an anonymous wrapper. Waiting on `#bug-severity > span:nth-of-type(1)`
 * works today and breaks the first time anyone touches that markup, while the
 * panel two lines down usually has an id. Prefer something durable; fall back to
 * the biggest only when nothing that appeared has a real handle on it.
 */
const mostProminent = (list: PickResult[]): PickResult | undefined => {
  const byArea = [...list].sort(
    (a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
  );
  return byArea.find((p) => !toRobotLocator(p).fragile) ?? byArea[0];
};

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
    reason: change.rerendered
      ? 'the list was rebuilt in place — nothing new to wait for, so this step can race the redraw'
      : 'the page did not react — just checking the target is there',
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
