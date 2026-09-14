/**
 * The result card. Renders every candidate with its score so the trade-off is
 * visible at the moment of choosing — the whole point of the tool.
 *
 * Built entirely from DOM nodes: this must work on pages that enforce Trusted
 * Types, where innerHTML throws. See dom-build.ts.
 */
import type { PickResult, SelectorCandidate } from '@/core/types';
import { TARGET_LABELS, toCode, type ExportTarget } from '@/core/export';
import { robotActionsFor } from '@/core/robot';
import { registerOwnHost, unregisterOwnHost } from './ignore';
import { applyStyle, h, replace } from './dom-build';
import { copy } from './deliver';

const HUD_ID = 'zelector-hud-host';
const TARGETS: ExportTarget[] = [
  'robot', 'robot-locator',
  'playwright-ts', 'playwright-py', 'selenium-py', 'puppeteer', 'cypress',
  'css', 'xpath-ish', 'json',
];

export class Hud {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private card: HTMLDivElement | null = null;
  private result: PickResult | null = null;
  private target: ExportTarget = 'robot';
  /** Which SeleniumLibrary keyword the Robot snippet renders; null = the primary one. */
  private robotKeyword: string | null = null;
  /**
   * Set while a recording is in progress: the chip row then doubles as the way
   * to add an assertion to the flow, which is the only thing a recorder cannot
   * capture by watching.
   */
  private addStep: ((keyword: string) => void) | null = null;

  /** Pass null to go back to plain inspection. */
  setAddStep(handler: ((keyword: string) => void) | null): void {
    this.addStep = handler;
    if (this.result) this.render();
  }

  show(result: PickResult): void {
    this.result = result;
    this.mount();
    this.render();
  }

  hide(): void {
    if (this.host) unregisterOwnHost(this.host);
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.card = null;
    this.result = null;
  }

  get element(): HTMLElement | null {
    return this.host;
  }

  private mount(): void {
    if (this.host) return;
    const host = h('div', { attrs: { id: HUD_ID }, style: 'all:initial;position:fixed;z-index:2147483646;' });
    const shadow = host.attachShadow({ mode: 'closed' });
    applyStyle(shadow, STYLE);

    const card = h('div', { class: 'card' });
    shadow.append(card);
    (document.documentElement || document.body).appendChild(host);
    registerOwnHost(host);

    this.host = host;
    this.shadow = shadow;
    this.card = card;
  }

  private render(): void {
    const { card, result } = this;
    if (!card || !result) return;

    replace(
      card,
      this.renderHeader(result),
      result.hops.length ? renderHops(result) : null,
      this.renderCandidates(result),
      this.renderFooter(result),
    );
  }

  private renderHeader(result: PickResult): HTMLElement {
    return h(
      'header',
      {},
      h('span', { class: 'tag', text: `<${result.tagName}>` }),
      h('span', { class: 'text', text: result.text.slice(0, 48) }),
      h('button', { class: 'close', text: '✕', title: 'Close', on: { click: () => this.hide() } }),
    );
  }

  private renderCandidates(result: PickResult): HTMLElement {
    return h('ul', { class: 'cands' }, ...result.candidates.map((c) => renderCandidate(c)));
  }

  /**
   * The keywords worth running against this element. A test is mostly
   * assertions, so the alternatives matter as much as the obvious action —
   * but the list stays short enough to scan without reading.
   */
  private renderActions(result: PickResult): HTMLElement | null {
    const actions = robotActionsFor(result);
    if (actions.length < 2 && !this.addStep) return null;

    const current = this.robotKeyword ?? actions[0]!.keyword;
    const add = this.addStep;
    return h(
      'div',
      { class: 'actions' },
      ...actions.map((a) =>
        h('button', {
          class: a.keyword === current ? 'action on' : 'action',
          text: a.keyword,
          on: {
            click: () => {
              this.robotKeyword = a.keyword;
              this.render();
            },
          },
        }),
      ),
      add
        ? h('button', {
            class: 'action add',
            text: '＋ Add as step',
            title: 'Append this to the recording',
            on: { click: () => add(current) },
          })
        : null,
    );
  }

  private renderFooter(result: PickResult): HTMLElement {
    const select = h(
      'select',
      {
        class: 'target',
        on: {
          change: (event) => {
            this.target = (event.target as HTMLSelectElement).value as ExportTarget;
            this.robotKeyword = null;
            this.render();
          },
        },
      },
      ...TARGETS.map((t) =>
        h('option', { value: t, text: TARGET_LABELS[t], selected: t === this.target }),
      ),
    );

    const code = toCode(result, this.target, this.robotKeyword ?? undefined);
    return h(
      'footer',
      {},
      select,
      this.target === 'robot' ? this.renderActions(result) : null,
      h('pre', { class: 'code', text: code }),
      h('button', {
        class: 'copy-code',
        text: 'Copy code',
        on: { click: (event) => void copy(code, event.currentTarget as HTMLElement) },
      }),
    );
  }
}

function renderHops(result: PickResult): HTMLElement {
  const chips: Array<Node | string> = [];
  result.hops.forEach((hop, i) => {
    if (i > 0) chips.push(h('span', { class: 'arrow', text: '→' }));
    const label = hop.type === 'shadow' ? (hop.closed ? '🔒 closed shadow' : '⧉ shadow') : '▣ iframe';
    chips.push(h('span', { class: hop.closed ? 'hop closed' : 'hop', text: label }));
  });
  return h('div', { class: 'hops' }, ...chips);
}

function renderCandidate(c: SelectorCandidate): HTMLElement {
  const tier = c.score >= 80 ? 'good' : c.score >= 55 ? 'ok' : 'bad';

  const meta = h(
    'div',
    { class: 'meta' },
    h('span', { class: 'kind', text: c.kind }),
    h('span', { class: 'engine', text: c.engine }),
    c.matches !== 1 ? h('span', { class: 'warn', text: `matches ${c.matches}` }) : null,
    ...c.notes.map((n) => h('span', { class: 'note', text: n })),
  );

  return h(
    'li',
    { class: `cand ${tier}` },
    h('span', { class: 'score', text: String(c.score) }),
    h('div', { class: 'body' }, h('code', { text: c.value }), meta),
    h('button', {
      class: 'cand-copy',
      text: '⧉',
      title: 'Copy',
      on: { click: (event) => void copy(c.value, event.currentTarget as HTMLElement) },
    }),
  );
}

const STYLE = `
:host { all: initial; }
.card {
  position: fixed; right: 16px; bottom: 16px; width: 420px; max-height: 70vh;
  display: flex; flex-direction: column; overflow: hidden;
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #e9e7f5; background: #16142a;
  border: 1px solid #2f2a4d; border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0,0,0,.5);
}
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2f2a4d; }
header .tag { font: 600 12px ui-monospace, Menlo, monospace; color: #b9a6ff; }
header .text { flex: 1; color: #8f89ad; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header .close { background: none; border: 0; color: #8f89ad; cursor: pointer; font-size: 14px; padding: 2px 4px; }
header .close:hover { color: #fff; }

.hops { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: #1c1936; font-size: 11px; }
.hop { background: #2b2550; color: #c4b5fd; padding: 2px 7px; border-radius: 4px; }
.hop.closed { background: #4a2a2a; color: #fca5a5; }
.arrow { color: #56507a; }

.cands { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; }
.cand { display: flex; align-items: flex-start; gap: 9px; padding: 8px; border-radius: 8px; }
.cand + .cand { margin-top: 2px; }
.cand:hover { background: #1e1b38; }
.cand .score {
  flex: 0 0 30px; text-align: center; font: 700 12px ui-monospace, Menlo, monospace;
  padding: 3px 0; border-radius: 5px;
}
.cand.good .score { background: #14532d; color: #86efac; }
.cand.ok   .score { background: #533f14; color: #fde68a; }
.cand.bad  .score { background: #531414; color: #fca5a5; }
.cand .body { flex: 1; min-width: 0; }
.cand code {
  display: block; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #f0edff;
  word-break: break-all;
}
.cand .meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; font-size: 10.5px; }
.cand .kind, .cand .engine { background: #2b2550; color: #a99ee0; padding: 1px 6px; border-radius: 3px; }
.cand .note { color: #7d7799; }
.cand .warn { background: #4a2a2a; color: #fca5a5; padding: 1px 6px; border-radius: 3px; }
.cand-copy { background: none; border: 0; color: #6f6996; cursor: pointer; font-size: 13px; padding: 2px 4px; }
.cand-copy:hover { color: #fff; }

footer { border-top: 1px solid #2f2a4d; padding: 10px 12px; display: grid; gap: 8px; }
footer .target {
  font: inherit; background: #221e3e; color: #e9e7f5;
  border: 1px solid #3a3363; border-radius: 6px; padding: 5px 8px;
}
footer .actions { display: flex; flex-wrap: wrap; gap: 5px; }
footer .action {
  font: 11px inherit; background: #221e3e; color: #a99ee0;
  border: 1px solid #3a3363; border-radius: 5px; padding: 3px 8px; cursor: pointer;
}
footer .action:hover { border-color: #7c5cff; color: #e9e7f5; }
footer .action.on { background: #3a2f6e; border-color: #7c5cff; color: #fff; }
footer .action.add { background: #1e3a2f; border-color: #2f6e52; color: #86efac; margin-left: auto; }
footer .action.add:hover { border-color: #34d399; color: #d1fae5; }
footer .code {
  margin: 0; padding: 9px; background: #0f0d1f; border-radius: 6px;
  font: 11.5px/1.6 ui-monospace, Menlo, monospace; color: #c9c4e8;
  white-space: pre-wrap; word-break: break-all; max-height: 130px; overflow: auto;
}
footer .copy-code {
  font: 600 12px inherit; background: #7c5cff; color: #fff;
  border: 0; border-radius: 6px; padding: 7px; cursor: pointer;
}
footer .copy-code:hover { background: #8f73ff; }
`;
