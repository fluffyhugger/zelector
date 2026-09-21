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
import { linkLedTo } from '@/core/navigation';
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
  private typing: {
    el: Element;
    target: PickResult;
    value: string;
    /** A contenteditable holds text rather than a value, so what was typed is
     *  accumulated from the events rather than read back off the element. */
    editable?: boolean;
  } | null = null;
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
   * When the pointer last went down, kept after the press is consumed.
   *
   * onPointerDown closes the watching window, which is what keeps a calendar
   * off the step that opens it — but only when a window is open to close. A
   * pause between typing and pressing leaves none: the window goes quiet after
   * 400ms while the typing is not flushed for 700ms, so the press lands in the
   * gap and the window that opens when the typing is finally flushed is already
   * watching the calendar this press opened. Recorded on DemoQA: the click on
   * the date field was preceded by a wait for react-datepicker's triangle.
   */
  private pressedAt = 0;
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
      window: { width: window.outerWidth, height: window.outerHeight },
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
    if (!this.steps.length) return;

    // Two ways to arrive on a new page, and they need opposite things.
    //
    // A recorded click that navigated is already accounted for: the next step
    // gets Wait Until Location Contains and the replay follows along on its
    // own. But a URL typed into the address bar, or a bookmark, leaves no trace
    // at all — the replay stays where it was and every step after it looks for
    // things that are not there. That is a suite that opens the wrong page.
    //
    // Time tells them apart when the site is quick: a navigation a click caused
    // follows it within a second or two, and one a person chose does not. When
    // the site is slow it tells them apart wrongly, so ask the link as well —
    // it says where it was going, and that does not expire.
    const last = this.steps[this.steps.length - 1]!;
    const followedAnAction =
      Date.now() - last.at < NAVIGATION_GRACE ||
      (last.kind === 'click' &&
        linkLedTo({ href: last.target.attributes['href'], from: last.target.url }, location.href));

    if (!followedAnAction && last.target.url !== location.href) {
      this.steps.push({
        id: nextId(),
        kind: 'navigate',
        target: describe(document.documentElement),
        value: location.href,
        wait: { kind: 'none', timeoutS: 10, reason: 'opened directly — no recorded step led here' },
        at: Date.now(),
      });
      return;   // the Go To is the arrival; nothing left to wait for
    }

    this.pending = {
      forIndex: this.steps.length,
      change: { ...emptyChange(), url: location.href, elapsedMs: 1000 },
    };
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

    // A single-page app can add stylesheets long after load, so the hover rules
    // are re-read for each recording rather than once per page.
    forgetHoverSelectors();

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
    window.addEventListener('dblclick', this.onDoubleClick, true);
    window.addEventListener('contextmenu', this.onContextMenu, true);
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
    window.removeEventListener('dblclick', this.onDoubleClick, true);
    window.removeEventListener('contextmenu', this.onContextMenu, true);
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
    this.pressedAt = Date.now();

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

  /**
   * Kept cheap on purpose: this fires on every pixel of pointer movement, and
   * what it records is thrown away almost every time. The element is stored
   * raw and only resolved if a click later turns out to have needed it.
   */
  private onPointerOver = (event: PointerEvent): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const el = event.target instanceof Element ? event.target : null;
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
    // Shown by a stylesheet rather than by a script: no mutation to observe, so
    // the rule itself is the evidence, and it names what has to be hovered.
    const subject = hoverSubjectFor(el);
    if (subject) return subject;

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
    // An editor's own element is usually a <body> or a <div>, which the
    // structural rule below drops on the floor.
    const editable = editableHost(el);
    if (editable) {
      this.push({ kind: 'click', target: describe(editable), keyword: 'Click Element' });
      const aimed = this.steps[this.steps.length - 1];
      this.aiming = aimed ? { id: aimed.id, el: editable } : null;
      return;
    }

    if (isTextEntry(el)) {
      // A combobox's input is often not clickable in its own right; the control
      // drawn around it is. The field is still what the typing belongs to, so
      // the step remembers which field it was aiming at.
      const clickable = reachable(el);
      this.push({ kind: 'click', target: describe(clickable), keyword: 'Click Element' });
      const pushed = this.steps[this.steps.length - 1];
      this.aiming = pushed ? { id: pushed.id, el } : null;
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
    // A toggle keeps its own element either way — Select Checkbox is aimed at the
    // input, and the label route above has already been taken if there is one.
    this.push({ kind, target: describe(kind === 'check' ? el : reachable(el)), ...toggleKeyword(el) });

    // A combobox is a control wrapped around a field. Pressing it is aiming as
    // much as pressing the field is, so if typing lands in that field next, this
    // click goes the same way an aiming click on a plain input goes.
    const pushed = this.steps[this.steps.length - 1];
    const field = kind === 'click' ? onlyTextEntryInside(el) : undefined;
    this.aiming = pushed && field ? { id: pushed.id, el: field } : this.aiming;
  };

  private onInput = (event: Event): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const el = event.target;

    // A rich text editor is a contenteditable, not a field: TinyMCE, CKEditor,
    // Quill and ProseMirror all put one on the page and none of them fires an
    // input event this handler used to accept. Recording one produced a suite
    // with nothing in it at all — no error, no step, no sign anything had
    // happened.
    const editable = el instanceof Element ? editableHost(el) : null;
    if (editable) {
      this.typeIntoEditor(editable, event);
      return;
    }

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
      const labels = Array.from(el.selectedOptions, (option) => option.label || option.value);
      if (el.multiple) {
        // One list, one step, however many options were ticked. change fires
        // per option, and three steps each selecting one label replay as three
        // calls where the last one is the only thing that matters — a multiple
        // select does not accumulate across calls.
        const last = this.steps[this.steps.length - 1];
        if (last?.kind === 'select' && sameElement(last.target, describe(el))) {
          last.values = labels;
          last.value = labels.join(', ');
          last.keyword = labels.length ? undefined : 'Unselect All From List';
          last.at = Date.now();
          this.emit();
          return;
        }
        this.push({
          kind: 'select',
          target: describe(el),
          value: labels.join(', '),
          values: labels,
          ...(labels.length ? {} : { keyword: 'Unselect All From List' }),
        });
        return;
      }
      this.push({ kind: 'select', target: describe(el), value: labels[0] ?? el.value });
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

  /**
   * The second click of a double click, which the browser has already delivered
   * as two ordinary clicks.
   *
   * push() merges a repeat click on the same element inside 400ms, so by the
   * time dblclick arrives there is one step to correct rather than two to
   * collapse. Replaying it as a single click is not the same gesture: a grid
   * that opens a cell editor, a word that selects on double click, a row that
   * expands — none of them react to one.
   */
  private onDoubleClick = (event: MouseEvent): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const raw = event.target instanceof Element ? event.target : null;
    if (!raw) return;
    const el = resolveTarget(raw);
    const last = this.steps[this.steps.length - 1];
    if (last?.kind === 'click' && sameElement(last.target, describe(el))) {
      last.keyword = 'Double Click Element';
      last.at = Date.now();
      this.emit();
      return;
    }
    this.push({ kind: 'click', target: describe(el), keyword: 'Double Click Element' });
  };

  /**
   * A right click, which no other event reports.
   *
   * The menu it opens belongs to the page or to the browser; either way what
   * the test has to reproduce is the press, and Open Context Menu is the
   * keyword for it. Nothing is recorded for the menu itself — if the page draws
   * one, clicking an item in it is an ordinary click and records itself.
   */
  private onContextMenu = (event: MouseEvent): void => {
    if (!this.capturing || isNotPageContent(event.target)) return;
    const raw = this.aimedAt(event)
      ?? deepElementFromPoint(event.clientX, event.clientY)
      ?? (event.target instanceof Element ? event.target : null);
    if (!raw || isNotPageContent(raw)) return;

    const el = resolveTarget(raw);
    // Counted as a click, or the menu it opens is credited to the pointer
    // having rested there — a Mouse Over step in front of the item, explaining
    // a menu that the right click opened.
    this.previousClick = this.lastClicked?.el ?? null;
    this.lastClicked = { el, at: Date.now() };
    this.push({ kind: 'click', target: describe(el), keyword: 'Open Context Menu' });
  };

  /**
   * The click that was only aiming at a field, and the field it aimed at.
   *
   * Kept by id because the step it produced may now name the control around the
   * field rather than the field itself, and the typing that follows has to be
   * able to say "that click was mine" all the same.
   */
  private aiming: { id: string; el: Element } | null = null;

  /** The press this click came from, if the pointer did not travel meanwhile. */
  private aimedAt(event: MouseEvent): Element | null {
    const pressed = this.pressed;
    this.pressed = null;
    if (!pressed || Date.now() - pressed.at > 2000) return null;
    const moved = Math.abs(pressed.x - event.clientX) + Math.abs(pressed.y - event.clientY);
    return moved <= 4 && pressed.el.isConnected ? pressed.el : null;
  }

  /**
   * What was typed into an editor, taken from the events rather than the DOM.
   *
   * The element's text is everything it already held, and replaying that would
   * type the document back into itself. `InputEvent.data` is the keystroke, and
   * the keystrokes are what a replay has to reproduce.
   */
  private typeIntoEditor(host: Element, event: Event): void {
    const typed = event instanceof InputEvent && event.inputType === 'insertText'
      ? event.data ?? ''
      : '';
    if (!typed) return;

    if (this.typing && this.typing.el !== host) this.flushTyping();
    this.typing = this.typing?.el === host
      ? { ...this.typing, value: this.typing.value + typed }
      : { el: host, target: describe(host), value: typed, editable: true };

    clearTimeout(this.typingTimer);
    this.typingTimer = window.setTimeout(() => this.flushTyping(), TYPING_IDLE_MS);
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
    const aimedHere = this.aiming?.id === last?.id && this.aiming?.el === typing.el;
    if (last?.kind === 'click' && (aimedHere || sameElement(last.target, typing.target))) {
      this.steps.pop();
      this.aiming = null;
    }
    // Input Text refuses a contenteditable — "Element must be user-editable" —
    // so what replays the typing is the same keyword a recorded Enter uses.
    this.push({
      kind: typing.editable ? 'key' : 'input',
      target: typing.target,
      value: typing.value,
    });
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
    // Not resolved: resolveTarget finds the thing a click meant, and looking
    // inside a hover subject finds whatever it reveals — which is the element
    // the hover exists to make reachable, not the one to hover.
    this.push({ kind: 'hover', target: describe(opener) });
  }

  private push(partial: {
    kind: StepKind;
    target: PickResult;
    value?: string;
    values?: string[];
    keyword?: string;
    dialog?: DialogStep;
    dropTarget?: PickResult;
  }): void {
    // Asked here, once per step, while the page still looks the way it did
    // when the person acted: a cookie bar that is dismissed later was there
    // for the steps recorded under it.
    const underBar = PRESS_STEPS.has(partial.kind) && hasEdgeBar();
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
    //
    // A step the pointer produced closes it at the press rather than now: a
    // window opened in between is watching what the press did, and that is the
    // next step's business.
    const fromPointer = PRESS_STEPS.has(partial.kind) && Date.now() - this.pressedAt < PRESS_GRACE;
    const change = this.watch
      ? this.watch.settle(fromPointer ? this.pressedAt : undefined)
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
      ...(partial.values !== undefined ? { values: partial.values } : {}),
      ...(underBar ? { underBar: true } : {}),
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

/**
 * The nearest thing a click can actually land on.
 *
 * react-select's combobox is a four-pixel input dropped into a grid cell with
 * the page's own markup drawn over it. It is what has focus and what the event
 * reports, so that is what gets recorded — and a replay clicking its centre is
 * told that another element would receive the click. What the person pressed
 * was the control around it.
 *
 * Only ever asked when the element fails its own hit test, so an ordinary field
 * is untouched. The climb stops at a form or a section, and at anything big
 * enough to be the page rather than a control: a locator for the whole layout
 * would replay as a click on the middle of the screen.
 */
function reachable(el: Element): Element {
  if (!(el instanceof HTMLElement) || isHitTestable(el)) return el;

  let candidate = el.parentElement;
  for (let hops = 0; candidate && hops < 4; hops += 1) {
    if (STRUCTURAL.has(candidate.tagName)) break;
    if (isHitTestable(candidate) && !fillsTheScreen(candidate)) return candidate;
    candidate = candidate.parentElement;
  }
  return el;
}

/** Too big to be the thing that was pressed. */
function fillsTheScreen(el: Element): boolean {
  const { width, height } = el.getBoundingClientRect();
  return width * height > window.innerWidth * window.innerHeight * 0.5;
}

/**
 * Ancestors whose `:hover` shows something, read from the page's own stylesheets.
 *
 * A menu opened by JavaScript announces itself: nodes arrive, or an attribute
 * changes, and the observer sees it. A menu opened by CSS announces nothing at
 * all — `.figure:hover .figcaption { display: block }` moves no nodes and fires
 * no events, so watching the DOM for it is watching for something that never
 * happens.
 *
 * What does exist is the rule. Every selector carrying `:hover` alongside a
 * declaration that shows or hides something names, in its own first half, the
 * element that has to be hovered. Collected once, since stylesheets rarely
 * change after load, and skipped entirely for the cross-origin ones the browser
 * will not read out.
 */
let hoverSubjects: string[] | null = null;

function forgetHoverSelectors(): void {
  hoverSubjects = null;
}

function revealingHoverSelectors(): string[] {
  if (hoverSubjects) return hoverSubjects;
  const found = new Set<string>();

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a stylesheet from somewhere else; its rules are not ours to read
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(':hover')) continue;
      if (!/display|visibility|opacity|transform|max-height/.test(rule.style.cssText)) continue;

      for (const selector of rule.selectorText.split(',')) {
        const subject = selector.split(':hover')[0]?.trim();
        // A bare `:hover` rule styles the hovered thing itself, which is not a
        // reveal — and an empty subject matches everything.
        if (subject) found.add(subject);
      }
    }
  }

  hoverSubjects = [...found];
  return hoverSubjects;
}

/** The nearest ancestor that shows this element only while it is hovered. */
function hoverSubjectFor(el: Element): Element | null {
  for (const selector of revealingHoverSelectors()) {
    let subject: Element | null = null;
    try {
      subject = el.closest(selector);
    } catch {
      continue; // a selector this engine will not parse
    }
    if (subject && subject !== el) return subject;
  }
  return null;
}

/** Far enough that nobody meant it as a click. */
const DRAG_THRESHOLD = 12;

/** Long enough to be resting rather than passing through. */
const HOVER_DWELL = 150;

/**
 * How soon after a step a navigation still counts as that step's doing. Longer
 * than a slow redirect, shorter than someone deciding where to go next.
 */
const NAVIGATION_GRACE = 2500;

/** Steps a press produces, and how long after one the press still explains it. */
const PRESS_STEPS = new Set<StepKind>(['click', 'check', 'drag']);
const PRESS_GRACE = 2000;

/** Selenium's names for the keys worth recording. */
const ACTING_KEYS: Record<string, string> = {
  Enter: 'RETURN',
  Escape: 'ESCAPE',
};

/**
 * Is the page keeping a bar pinned to the top or bottom of the window?
 *
 * Sticky headers, cookie bars, ad footers. They matter to a replay and to
 * nothing else: WebDriver scrolls an element the *smallest* distance that puts
 * it inside the viewport, which parks it against whichever edge it came from —
 * and a bar pinned to that edge is then on top of it. The click is refused with
 * "Other element would receive the click", after the wait has already passed,
 * because the element really is visible. It is simply underneath something.
 *
 * Measured rather than searched: elementsFromPoint down the middle of each
 * edge, which costs nothing on a page with ten thousand nodes. A bar is
 * something pinned that does not cover the page — a modal backdrop is fixed
 * too, and is not this.
 */
function hasEdgeBar(): boolean {
  const pinned = (x: number, y: number): boolean =>
    document.elementsFromPoint(Math.round(x), Math.round(y)).some((el) => {
      if (isNotPageContent(el)) return false;
      const position = getComputedStyle(el).position;
      if (position !== 'fixed' && position !== 'sticky') return false;
      const { height } = el.getBoundingClientRect();
      return height >= MIN_BAR_HEIGHT && height <= window.innerHeight * 0.4;
    });

  const { innerWidth: w, innerHeight: h } = window;
  // A band rather than a line, and three columns rather than one. data.go.th's
  // cookie banner floats twenty pixels clear of the bottom and is narrower than
  // the window, so a single probe at the centre of the edge went straight past
  // it — and the step recorded on the banner's own button was not marked.
  return [2, 24, 48, h - 3, h - 24, h - 48].some(
    (y) => y > 0 && y < h && [0.25, 0.5, 0.75].some((fraction) => pinned(w * fraction, y)),
  );
}

/** Shorter than this and nothing lands under it. */
const MIN_BAR_HEIGHT = 24;

/**
 * The one field inside a control, if that is all there is.
 *
 * react-select and every combobox like it: the thing pressed is a wrapper, and
 * the thing typed into is an input somewhere under it.
 */
function onlyTextEntryInside(el: Element): Element | undefined {
  const fields = [...el.querySelectorAll('input,textarea')].filter(isTextEntry);
  return fields.length === 1 ? fields[0] : undefined;
}

/**
 * The element an editor edits, if this is inside one.
 *
 * The outermost editable, not the nearest: ProseMirror and Quill nest editable
 * nodes, and the one with a locator worth writing down is the root.
 */
function editableHost(el: Element): Element | null {
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return null;
  let host: HTMLElement = el;
  let parent = host.parentElement;
  while (parent instanceof HTMLElement && parent.isContentEditable) {
    host = parent;
    parent = host.parentElement;
  }
  return host;
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
  const only = controls.length === 1 ? controls[0] : undefined;
  // Descending is right when the control fills the wrapper, as Angular
  // Material's does. react-select's is four pixels wide with a span drawn over
  // it, and handing that back records a click nothing can land on — the thing
  // pressed was the wrapper, and the wrapper is what stays.
  return only instanceof HTMLElement && isHitTestable(only) ? only : el;
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

function inferWait(change: PageChange, ownTarget: PickResult): WaitSpec {
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
