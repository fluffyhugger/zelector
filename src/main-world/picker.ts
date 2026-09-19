/**
 * The element picker. Lives in the MAIN world so it can walk into closed shadow
 * roots via the attachShadow hook — the one thing DevTools cannot do.
 */
import type { ContextHop, PickResult } from '@/core/types';
import { generateCandidates } from '@/core/selector';
import { normalizeText, rootOf } from '@/core/dom';
import { isClosedShadowHost, shadowRootOf } from './hooks';
import { isOwnNode, registerOwnHost, unregisterOwnHost } from './ignore';
import { applyStyle, h, kbdLine, replace } from './dom-build';

const HOST_ID = 'zelector-overlay-host';

/** macOS spells the modifier ⌥, not "Alt" — show users the key they actually press. */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
const ALT = IS_MAC ? '⌥' : 'Alt';

/** Events we swallow while frozen, so hover-only UI stays on screen. */
const HOVER_EVENTS = [
  'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
  'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'focusin', 'focusout', 'blur',
] as const;

export interface PickerCallbacks {
  onPick(result: PickResult): void;
  onCancel(): void;
  onStateChange(state: { picking: boolean; frozen: boolean }): void;
}

export class Picker {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private box: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private hint: HTMLDivElement | null = null;
  private hovered: Element | null = null;
  private picking = false;
  private frozen = false;

  constructor(private readonly callbacks: PickerCallbacks) {}

  get isPicking(): boolean {
    return this.picking;
  }

  toggle(): void {
    this.picking ? this.stop() : this.start();
  }

  start(): void {
    if (this.picking) return;
    this.picking = true;
    this.mount();
    // Registered before the freeze blocker so our handler always runs first.
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.onScroll, true);
    this.emitState();
  }

  stop(): void {
    if (!this.picking) return;
    this.picking = false;
    this.unfreeze();
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('scroll', this.onScroll, true);
    this.hovered = null;
    this.unmount();
    this.emitState();
  }

  /**
   * Stop the page from seeing hover/focus transitions. Dropdowns, tooltips and
   * popovers then stay open while the mouse travels to the Zelector panel —
   * the thing that makes them impossible to inspect in DevTools.
   */
  toggleFreeze(): void {
    this.frozen ? this.unfreeze() : this.freeze();
  }

  private freeze(): void {
    if (this.frozen) return;
    this.frozen = true;
    for (const type of HOVER_EVENTS) {
      window.addEventListener(type, this.swallow, true);
    }
    this.render();
    this.emitState();
  }

  private unfreeze(): void {
    if (!this.frozen) return;
    this.frozen = false;
    for (const type of HOVER_EVENTS) {
      window.removeEventListener(type, this.swallow, true);
    }
    this.render();
    this.emitState();
  }

  private swallow = (event: Event): void => {
    if (isOwnNode(event.target)) return;
    event.stopImmediatePropagation();
  };

  private emitState(): void {
    this.callbacks.onStateChange({ picking: this.picking, frozen: this.frozen });
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private onMouseMove = (event: MouseEvent): void => {
    if (isOwnNode(event.target)) return;
    const el = deepElementFromPoint(event.clientX, event.clientY);
    if (!el || el === this.hovered) return;
    this.hovered = el;
    this.render();
  };

  private onClick = (event: MouseEvent): void => {
    if (isOwnNode(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const el = deepElementFromPoint(event.clientX, event.clientY) ?? this.hovered;
    if (!el) return;
    this.callbacks.onPick(describe(el));
    this.stop();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.callbacks.onCancel();
      this.stop();
      return;
    }
    // Walk the selection up and down the tree without moving the mouse.
    if (event.key === 'ArrowUp' && this.hovered?.parentElement) {
      event.preventDefault();
      this.hovered = this.hovered.parentElement;
      this.render();
    }
    if (event.key === 'ArrowDown' && this.hovered?.firstElementChild) {
      event.preventDefault();
      this.hovered = this.hovered.firstElementChild;
      this.render();
    }
  };

  private onScroll = (): void => this.render();

  // ── Overlay ────────────────────────────────────────────────────────────────

  private mount(): void {
    if (this.host) return;
    const host = h('div', {
      attrs: { id: HOST_ID },
      style: 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;',
    });
    // Closed root: the inspected page cannot read or restyle our UI.
    const shadow = host.attachShadow({ mode: 'closed' });
    applyStyle(shadow, OVERLAY_STYLE);

    const box = h('div', { class: 'box', hidden: true });
    const label = h('div', { class: 'label', hidden: true });
    const hint = h('div', { class: 'hint' });
    shadow.append(box, label, hint);

    (document.documentElement || document.body).appendChild(host);
    registerOwnHost(host);

    this.host = host;
    this.shadow = shadow;
    this.box = box;
    this.label = label;
    this.hint = hint;
    this.render();
  }

  private unmount(): void {
    if (this.host) unregisterOwnHost(this.host);
    this.host?.remove();
    this.host = this.shadow = null;
    this.box = this.label = this.hint = null;
  }

  private render(): void {
    const { box, label, hint } = this;
    if (!box || !label || !hint) return;

    replace(
      hint,
      ...(this.frozen
        ? [
            h('span', { class: 'frozen', text: '❄ DOM frozen' }),
            ...kbdLine(' — hover menus stay open · ', [ALT], [SHIFT], ['F'], ' to thaw · ', ['Esc'], ' to exit'),
          ]
        : kbdLine('Click to pick · ', ['↑'], ['↓'], ' walk the tree · ', [ALT], [SHIFT], ['F'], ' freeze · ', ['Esc'], ' cancel')),
    );

    if (!this.hovered) {
      box.hidden = true;
      label.hidden = true;
      return;
    }

    const rect = this.hovered.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    label.hidden = false;
    replace(label, ...shortLabel(this.hovered));
    // Sit above the element unless that would run off the top of the viewport.
    const above = rect.top > 24;
    label.style.left = `${Math.max(4, rect.left)}px`;
    label.style.top = `${above ? rect.top - 22 : rect.bottom + 4}px`;
  }
}

// ── Free functions ───────────────────────────────────────────────────────────

/**
 * elementFromPoint stops at every shadow boundary. Recurse through each root —
 * including closed ones, which we hold from the attachShadow hook.
 */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  // Our own panels are closed shadow roots, and our own attachShadow hook is
  // what makes them walkable — so without this we happily descend into them.
  if (isOwnNode(el)) return null;
  let guard = 0;
  while (el && guard++ < 32) {
    const root = shadowRootOf(el);
    if (!root) break;
    const inner = root.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** The shadow hosts and frames between the top document and this element. */
function contextHops(el: Element): ContextHop[] {
  const hops: ContextHop[] = [];
  let node: Node = el;
  let guard = 0;
  while (guard++ < 32) {
    const root = node.getRootNode();
    if (!(root instanceof ShadowRoot)) break;
    const host = root.host;
    hops.unshift({
      type: 'shadow',
      hostSelector: bestSelectorFor(host),
      closed: isClosedShadowHost(host) || root.mode === 'closed',
    });
    node = host;
  }
  return [...frameHops(), ...hops];
}

/**
 * The frames between the top document and this one, outermost first.
 *
 * window.frameElement hands back the actual <iframe> in the parent document
 * whenever the parent is same-origin, so the selector is generated against the
 * real element the same way every other selector here is. Across an origin
 * boundary it throws, and all we have left is this document's own URL — a
 * guess, and flagged as one, because a Select Frame that picks the wrong frame
 * is worse than one that obviously needs filling in.
 */
function frameHops(): ContextHop[] {
  const hops: ContextHop[] = [];
  let win: Window = window;
  let guard = 0;

  while (win !== win.parent && guard++ < 8) {
    let hop: ContextHop;
    try {
      const frame = win.frameElement;
      hop = frame
        ? { type: 'iframe', hostSelector: bestSelectorFor(frame), reliable: true }
        : guessedFrameHop(win === window);
    } catch {
      hop = guessedFrameHop(win === window);
    }
    hops.unshift(hop);
    win = win.parent;
  }
  return hops;
}

/** Only the innermost frame knows its own URL; anything above it is anonymous. */
function guessedFrameHop(innermost: boolean): ContextHop {
  return {
    type: 'iframe',
    hostSelector: innermost ? `iframe[src*="${location.pathname}"]` : 'iframe',
    reliable: false,
  };
}

function bestSelectorFor(el: Element): string {
  return generateCandidates(el)[0]?.value ?? el.tagName.toLowerCase();
}

export function describe(el: Element): PickResult {
  const rect = el.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) attributes[attr.name] = attr.value;
  const text = normalizeText(el.textContent).slice(0, 160);

  return {
    tagName: el.tagName.toLowerCase(),
    text,
    ...(el.tagName === 'A' ? { linkTextMatches: countLinksReading(el, text) } : {}),
    attributes,
    hops: contextHops(el),
    candidates: generateCandidates(el),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    url: location.href,
    pickedAt: Date.now(),
  };
}

/**
 * How many links in this tree read the same. Scoped the way every other count
 * here is: a link inside a shadow root competes only with its own neighbours.
 */
function countLinksReading(el: Element, text: string): number {
  if (!text) return 0;
  return Array.from(rootOf(el).querySelectorAll('a'))
    .filter((link) => normalizeText(link.textContent).slice(0, 160) === text).length;
}

/** Compact identity line shown next to the highlight box. */
function shortLabel(el: Element): Array<Node | string> {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  const testid = el.getAttribute('data-testid') ?? el.getAttribute('data-cy');
  const cls = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
  const rect = el.getBoundingClientRect();
  const ident = testid ? `[${testid}]` : id ? `#${id}` : cls;

  const parts: Array<Node | string> = [`${tag}${ident}`];
  if (shadowRootOf(el)) parts.push(h('span', { class: 'dim', text: ' ▸shadow' }));
  if (el.getRootNode() instanceof ShadowRoot) parts.push(h('span', { class: 'dim', text: ' ⧉' }));
  parts.push(' ', h('span', { class: 'dim', text: `${Math.round(rect.width)}×${Math.round(rect.height)}` }));
  return parts;
}

const SHIFT = '⇧';

const OVERLAY_STYLE = `
:host { all: initial; }
.box {
  position: fixed;
  border: 2px solid #7c5cff;
  background: rgba(124, 92, 255, 0.14);
  border-radius: 3px;
  pointer-events: none;
  transition: all 60ms linear;
}
.label {
  position: fixed;
  font: 500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #fff;
  background: #7c5cff;
  padding: 3px 7px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
  max-width: 90vw;
  overflow: hidden;
  text-overflow: ellipsis;
}
.label .dim { opacity: .7; }
.hint {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  font: 500 12px/1.6 ui-sans-serif, system-ui, sans-serif;
  color: #e8e6f5; background: rgba(20,18,34,.94);
  padding: 7px 14px; border-radius: 999px; pointer-events: none;
  box-shadow: 0 4px 20px rgba(0,0,0,.4);
}
.hint kbd {
  font: inherit; background: rgba(255,255,255,.14);
  padding: 1px 5px; border-radius: 3px; margin: 0 1px;
}
.hint .frozen { color: #6ee7b7; }
`;
