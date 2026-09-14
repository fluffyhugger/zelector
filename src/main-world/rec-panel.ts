/**
 * The recording panel.
 *
 * Every recorder on the market asks you to choose a wait at the moment you
 * click, which interrupts the flow you are trying to reproduce and — worse —
 * folds your thinking time into the timings it measures. So this records
 * silently and shows its guesses here, one editable row per step.
 *
 * The ⓘ line under each row is the point of the whole panel: it says why the
 * wait was chosen. A tester who reads a few of those learns what to wait for,
 * which is the part no recorder has ever taught anyone.
 */
import {
  WAIT_LABELS,
  WAIT_ORDER,
  actionForStep,
  defaultDoc,
  toRobotSuite,
  type RecordedStep,
  type Recording,
  type WaitKind,
  type WaitSpec,
} from '@/core/recording';
import { robotActionsFor } from '@/core/robot';
import { registerOwnHost, unregisterOwnHost } from './ignore';
import { applyStyle, h, replace } from './dom-build';
import { copy, download, robotFilename } from './deliver';

const HOST_ID = 'zelector-rec-host';

export interface RecPanelCallbacks {
  onStop(): void;
  /** Open the picker so an assertion can be appended to the flow. */
  onAddAssertion(): void;
  onName(name: string): void;
  onDoc(doc: string): void;
  onClear(): void;
  onRemove(id: string): void;
  onWait(id: string, patch: Partial<WaitSpec>): void;
  onKeyword(id: string, keyword: string): void;
}

export class RecPanel {
  private host: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  private recording: Recording | null = null;
  private showCode = false;
  /**
   * Closed by hand. Every recorder change calls show(), so without this any
   * stray emit after the close — a typing buffer flushing, an observer
   * settling — puts the panel straight back on screen.
   */
  private dismissed = false;

  constructor(private readonly callbacks: RecPanelCallbacks) {}

  show(recording: Recording): void {
    // A new recording is always worth showing; nothing else reopens it.
    if (this.dismissed && !recording.active) return;
    this.dismissed = false;
    this.recording = recording;
    this.mount();
    this.render();
  }

  hide(): void {
    this.dismissed = true;
    if (this.host) unregisterOwnHost(this.host);
    this.host?.remove();
    this.host = null;
    this.card = null;
    this.recording = null;
  }

  private mount(): void {
    if (this.host) return;
    const host = h('div', { attrs: { id: HOST_ID }, style: 'all:initial;position:fixed;z-index:2147483645;' });
    const shadow = host.attachShadow({ mode: 'closed' });
    applyStyle(shadow, STYLE);

    const card = h('div', { class: 'panel' });
    shadow.append(card);
    (document.documentElement || document.body).appendChild(host);
    registerOwnHost(host);

    this.host = host;
    this.card = card;
  }

  private render(): void {
    const { card, recording } = this;
    if (!card || !recording) return;

    replace(
      card,
      this.renderHeader(recording),
      this.renderMeta(recording),
      this.showCode ? this.renderCode(recording) : this.renderSteps(recording),
      !this.showCode && recording.active ? this.renderAddAssertion() : null,
      this.renderFooter(recording),
    );
  }

  private renderHeader(rec: Recording): HTMLElement {
    return h(
      'header',
      {},
      h('span', { class: rec.active ? 'dot live' : 'dot', text: '●' }),
      h('span', { class: 'title', text: rec.active ? 'Recording' : 'Recorded' }),
      h('span', { class: 'count', text: `${rec.steps.length} step${rec.steps.length === 1 ? '' : 's'}` }),
      h('button', {
        class: 'stop',
        text: rec.active ? '⏹ Stop' : '✕ Close',
        on: { click: () => this.callbacks.onStop() },
      }),
    );
  }

  /**
   * The name and [Documentation] of the test case. Committed on change rather
   * than on input: a step arriving mid-keystroke re-renders the panel, which
   * would otherwise take the half-typed name with it.
   */
  private renderMeta(rec: Recording): HTMLElement {
    return h(
      'div',
      { class: 'meta' },
      h(
        'label',
        {},
        h('span', { class: 'lbl', text: 'test' }),
        h('input', {
          class: 'name',
          value: rec.name ?? '',
          attrs: { placeholder: 'Recorded Flow', spellcheck: 'false' },
          on: {
            change: (event) => this.callbacks.onName((event.target as HTMLInputElement).value),
          },
        }),
      ),
      h(
        'label',
        {},
        h('span', { class: 'lbl', text: 'doc' }),
        h('input', {
          class: 'doc',
          value: rec.doc ?? '',
          attrs: { placeholder: defaultDoc(rec) },
          on: {
            change: (event) => this.callbacks.onDoc((event.target as HTMLInputElement).value),
          },
        }),
      ),
    );
  }

  private renderSteps(rec: Recording): HTMLElement {
    if (!rec.steps.length) {
      return h(
        'div',
        { class: 'empty' },
        h('p', { text: 'Use the page as you normally would.' }),
        h('p', { class: 'dim', text: 'Clicks, typing and dropdowns are captured.' }),
      );
    }
    return h('ol', { class: 'steps' }, ...rec.steps.map((step, i) => this.renderStep(step, i)));
  }

  private renderStep(step: RecordedStep, index: number): HTMLElement {
    const action = actionForStep(step);
    const alternatives = robotActionsFor(step.target);

    const keywordPicker = step.kind === 'navigate'
      ? h('span', { class: 'kw', text: 'Go To' })
      : h(
          'select',
          {
            class: 'kw',
            on: {
              change: (event) =>
                this.callbacks.onKeyword(step.id, (event.target as HTMLSelectElement).value),
            },
          },
          ...alternatives.map((a) =>
            h('option', { value: a.keyword, text: a.keyword, selected: a.keyword === action.keyword }),
          ),
        );

    return h(
      'li',
      { class: 'step' },
      h(
        'div',
        { class: 'line' },
        h('span', { class: 'idx', text: String(index + 1) }),
        keywordPicker,
        h('code', { class: 'tgt', text: targetLabel(step) }),
        h('button', {
          class: 'x',
          text: '✕',
          title: 'Remove this step',
          on: { click: () => this.callbacks.onRemove(step.id) },
        }),
      ),
      this.renderWait(step),
      step.wait.reason
        ? h('div', { class: step.wait.provisional ? 'why guess' : 'why' }, `ⓘ ${step.wait.reason}`)
        : null,
    );
  }

  private renderWait(step: RecordedStep): HTMLElement {
    const kindSelect = h(
      'select',
      {
        class: step.wait.kind === 'sleep' ? 'wait danger' : 'wait',
        on: {
          change: (event) =>
            this.callbacks.onWait(step.id, {
              kind: (event.target as HTMLSelectElement).value as WaitKind,
            }),
        },
      },
      ...WAIT_ORDER.map((kind) =>
        h('option', { value: kind, text: WAIT_LABELS[kind], selected: kind === step.wait.kind }),
      ),
    );

    return h(
      'div',
      { class: 'waitrow' },
      h('span', { class: 'lbl', text: 'wait' }),
      kindSelect,
      ...this.renderWaitArg(step),
    );
  }

  private renderWaitArg(step: RecordedStep): Array<Node | null> {
    const { wait } = step;
    if (wait.kind === 'none') return [];

    if (wait.kind === 'sleep') {
      return [
        numberInput(String(wait.seconds ?? 1), (value) =>
          this.callbacks.onWait(step.id, { seconds: Number(value) || 1 }),
        ),
        h('span', { class: 'unit', text: 's' }),
      ];
    }

    if (wait.kind === 'location') {
      return [
        h('input', {
          class: 'frag',
          value: wait.urlFragment ?? '/',
          on: {
            change: (event) =>
              this.callbacks.onWait(step.id, { urlFragment: (event.target as HTMLInputElement).value }),
          },
        }),
        timeoutInput(step, this.callbacks),
      ];
    }

    return [
      wait.target ? h('code', { class: 'wtgt', text: `<${wait.target.tagName}>` }) : null,
      timeoutInput(step, this.callbacks),
    ];
  }

  /**
   * Assertions are the one thing watching a page cannot capture, so the way to
   * add one has to stay on screen. It used to live in the empty state, which
   * meant the instruction disappeared the moment recording actually started.
   */
  private renderAddAssertion(): HTMLElement {
    return h(
      'button',
      { class: 'add-assert', on: { click: () => this.callbacks.onAddAssertion() } },
      h('span', { text: '＋ Add assertion' }),
      h('kbd', { text: '⌥Z' }),
    );
  }

  private renderCode(rec: Recording): HTMLElement {
    return h('pre', { class: 'code', text: toRobotSuite(rec) });
  }

  private renderFooter(rec: Recording): HTMLElement {
    const suite = toRobotSuite(rec);
    return h(
      'footer',
      {},
      h('button', {
        class: 'ghost',
        text: this.showCode ? '← Steps' : 'Preview',
        on: {
          click: () => {
            this.showCode = !this.showCode;
            this.render();
          },
        },
      }),
      h('button', {
        class: 'ghost',
        text: 'Clear',
        on: { click: () => this.callbacks.onClear() },
      }),
      h('button', {
        class: 'ghost',
        text: 'Copy',
        on: { click: (event) => void copy(suite, event.currentTarget as HTMLElement) },
      }),
      h('button', {
        class: 'primary',
        text: `⤓ ${robotFilename(rec.name)}`,
        title: 'Save the suite as a .robot file',
        on: {
          click: (event) => download(suite, robotFilename(rec.name), event.currentTarget as HTMLElement),
        },
      }),
    );
  }
}

function numberInput(value: string, onChange: (value: string) => void): HTMLElement {
  // Through attrs, not the value property: switching an input's type after the
  // fact can drop a value the browser no longer considers valid for it.
  return h('input', {
    class: 'num',
    attrs: { type: 'number', min: '1', value },
    on: { change: (event) => onChange((event.target as HTMLInputElement).value) },
  });
}

function timeoutInput(step: RecordedStep, callbacks: RecPanelCallbacks): HTMLElement {
  return h(
    'span',
    { class: 'to' },
    numberInput(String(step.wait.timeoutS), (value) =>
      callbacks.onWait(step.id, { timeoutS: Number(value) || 10 }),
    ),
    h('span', { class: 'unit', text: 's' }),
  );
}

function targetLabel(step: RecordedStep): string {
  if (step.kind === 'navigate') return step.value ?? '';
  const { attributes, tagName } = step.target;
  const ident =
    attributes['data-testid'] ?? attributes['data-cy'] ?? attributes['id'] ?? attributes['name'];
  const base = ident ? `${tagName}[${ident}]` : `<${tagName}>`;
  return step.value ? `${base} ← ${step.value.slice(0, 24)}` : base;
}

const STYLE = `
:host { all: initial; }
.panel {
  position: fixed; left: 16px; bottom: 16px; width: 460px; max-height: 76vh;
  display: flex; flex-direction: column; overflow: hidden;
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #e9e7f5; background: #16142a;
  border: 1px solid #2f2a4d; border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0,0,0,.5);
}
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2f2a4d; }
header .dot { color: #56507a; font-size: 10px; }
header .dot.live { color: #f87171; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
header .title { font-weight: 600; }
header .count { flex: 1; color: #8f89ad; font-size: 11.5px; }
header .stop {
  font: 600 11.5px inherit; background: #2b2550; color: #e9e7f5;
  border: 1px solid #3a3363; border-radius: 6px; padding: 4px 10px; cursor: pointer;
}
header .stop:hover { border-color: #7c5cff; }

.meta { padding: 8px 12px; border-bottom: 1px solid #221e3e; display: grid; gap: 5px; }
.meta label { display: flex; align-items: center; gap: 7px; }
.meta .lbl { flex: 0 0 26px; color: #56507a; font-size: 10.5px; }
.meta input {
  flex: 1; min-width: 0; font: inherit; background: #221e3e; color: #e9e7f5;
  border: 1px solid #3a3363; border-radius: 5px; padding: 3px 7px;
}
.meta input:focus { outline: none; border-color: #7c5cff; }
.meta .name { font-weight: 600; }
.meta .doc { font-size: 11.5px; color: #a99ee0; }
.meta input::placeholder { color: #56507a; }

.empty { padding: 22px 16px; text-align: center; color: #a99ee0; }
.empty p { margin: 0 0 6px; }
.empty .dim { color: #7d7799; font-size: 11.5px; }

.steps { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; }
.step { padding: 7px 8px; border-radius: 8px; }
.step + .step { margin-top: 2px; border-top: 1px solid #221e3e; }
.step:hover { background: #1b1834; }
.line { display: flex; align-items: center; gap: 7px; }
.idx { flex: 0 0 18px; color: #56507a; font: 600 11px ui-monospace, Menlo, monospace; }
.kw {
  font: 600 11.5px inherit; background: #2b2550; color: #c4b5fd;
  border: 1px solid #3a3363; border-radius: 5px; padding: 2px 6px; max-width: 190px;
}
select.kw { cursor: pointer; }
.tgt { flex: 1; min-width: 0; font: 11px ui-monospace, Menlo, monospace; color: #8f89ad;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { background: none; border: 0; color: #56507a; cursor: pointer; font-size: 11px; padding: 2px 4px; }
.x:hover { color: #fca5a5; }

.waitrow { display: flex; align-items: center; gap: 6px; margin: 5px 0 0 25px; }
.waitrow .lbl { color: #56507a; font-size: 10.5px; }
.wait {
  font: 11px inherit; background: #221e3e; color: #a99ee0;
  border: 1px solid #3a3363; border-radius: 5px; padding: 2px 5px; cursor: pointer; max-width: 215px;
}
.wait.danger { color: #fca5a5; border-color: #6b2c2c; }
.num { font: 11px ui-monospace, Menlo, monospace; width: 38px; background: #221e3e; color: #e9e7f5;
  border: 1px solid #3a3363; border-radius: 5px; padding: 2px 4px; }
.frag { font: 11px ui-monospace, Menlo, monospace; flex: 1; min-width: 0; background: #221e3e; color: #e9e7f5;
  border: 1px solid #3a3363; border-radius: 5px; padding: 2px 5px; }
.unit { color: #56507a; font-size: 10.5px; }
.wtgt { font: 11px ui-monospace, Menlo, monospace; color: #7d7799; }
.to { display: inline-flex; align-items: center; gap: 3px; }

.why { margin: 4px 0 0 25px; font-size: 10.5px; color: #6f6996; }
.why.guess { color: #b08a4a; }

.code {
  margin: 0; padding: 12px; background: #0f0d1f; flex: 1; overflow: auto;
  font: 11.5px/1.6 ui-monospace, Menlo, monospace; color: #c9c4e8; white-space: pre;
}

.add-assert {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin: 0 8px 8px; padding: 7px; font: 500 11.5px inherit; cursor: pointer;
  background: none; color: #86efac;
  border: 1px dashed #2f6e52; border-radius: 7px;
}
.add-assert:hover { background: #17301f; border-color: #34d399; }
.add-assert kbd {
  font: 10.5px ui-monospace, Menlo, monospace; color: #6f9a80;
  border: 1px solid #2f6e52; border-radius: 4px; padding: 1px 5px;
}

footer { border-top: 1px solid #2f2a4d; padding: 9px 12px; display: flex; gap: 7px; }
footer .ghost {
  font: 500 11.5px inherit; background: #221e3e; color: #a99ee0;
  border: 1px solid #3a3363; border-radius: 6px; padding: 6px 10px; cursor: pointer;
}
footer .ghost:hover { border-color: #7c5cff; color: #e9e7f5; }
footer .primary {
  flex: 1; min-width: 0; font: 600 12px ui-monospace, Menlo, monospace;
  background: #7c5cff; color: #fff; border: 0; border-radius: 6px;
  padding: 6px 8px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
footer .primary:hover { background: #8f73ff; }
`;
