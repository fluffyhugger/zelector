/**
 * Watches what the page does after an action.
 *
 * This is the part that separates a useful recording from the usual pile of
 * `Sleep    2s`. A recorder cannot record a wait — nobody performs one — so it
 * has to be inferred from what actually happened: which requests fired, which
 * elements appeared, which ones came and went again.
 *
 * The come-and-go case is the valuable one. A spinner that appears after the
 * click and is gone by the time the window closes is, almost by definition, the
 * thing the next step needs to wait out.
 *
 * Which is exactly why the window has to close the instant the user acts again.
 * A dropdown opens on click and closes when an option is picked; leave the
 * window open across both and it looks identical to a spinner, and the step gets
 * a Wait Until Element Is Not Visible on a menu that only ever opens. That wait
 * can never pass. Anything after the next action is that action's business.
 */
import type { PickResult } from '@/core/types';
import { capturedResponses, type CapturedResponse } from './hooks';
import { isNotPageContent } from './ignore';
import { describe } from './picker';

/** Stop waiting once the DOM has been still for this long. */
const QUIET_MS = 400;
/** …but never watch a single action for longer than this. */
const MAX_MS = 6000;
/** Describing an element is not free; a busy page can add hundreds. */
const MAX_TRACKED = 16;

export interface PageChange {
  /** Appeared during the window and still there when it closed. */
  appeared: PickResult[];
  /**
   * The same elements, undescribed. Never leaves this world — it is here so a
   * caller can ask whether the thing about to be clicked is inside something
   * that just arrived, which no amount of comparing locators can answer.
   */
  appearedEls: Element[];
  /** Appeared and was gone again before the window closed — a spinner, a toast. */
  transient: PickResult[];
  requests: CapturedResponse[];
  /** Set when the document navigated or the SPA route changed. */
  url?: string;
  /**
   * Nodes were swapped out for lookalikes — a framework rebuilding a list.
   * Nothing new to wait for, and the next click may land mid-commit, which is
   * worth saying out loud rather than papering over.
   */
  rerendered: boolean;
  elapsedMs: number;
}

export const emptyChange = (): PageChange => ({
  appeared: [],
  appearedEls: [],
  transient: [],
  requests: [],
  rerendered: false,
  elapsedMs: 0,
});

/**
 * Enough to tell "this row came back" from "this dialog arrived". Deliberately
 * cheap: it runs for every node a busy page takes out.
 */
function identity(el: Element): string {
  const attrs = el.attributes;
  const test = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? '';
  // getAttribute rather than className: on an SVG, className is an
  // SVGAnimatedString, and interpolating one gives the same
  // "[object SVGAnimatedString]" for every icon on the page — so a spinner
  // leaving and an unrelated icon arriving looked like one element being
  // redrawn, and both were discarded.
  return `${el.tagName}#${el.id}[${test}].${el.getAttribute('class') ?? ''}:${attrs.length}`;
}

/**
 * A disappearance that is still on screen was a replacement, not an exit.
 *
 * The mirror of the arrival check. A form that re-renders on every keystroke
 * takes its heading out and puts an identical one back, and the one taken out
 * looks exactly like a spinner clearing — which is how a step came to wait for
 * `data:test:title` to stop being visible on a page that shows it throughout.
 */
function stillOnScreen(result: PickResult): boolean {
  const css = result.candidates.find((c) => c.engine === 'css')?.value;
  if (!css) return false;
  try {
    const found = document.querySelector(css);
    return !!found && isVisible(found);
  } catch {
    return false; // a selector the page will not accept tells us nothing
  }
}

/**
 * Did this attribute change take something from hidden to shown?
 *
 * Most menus and dialogs are built once and toggled, so they never arrive as
 * new nodes — and a menu that opens by dropping its `hidden` attribute looked,
 * to an observer watching only for additions, exactly like nothing happening.
 *
 * Only the changes that say so on their face are read this way. A class that
 * merely changed could mean anything, and treating every restyle as an arrival
 * would bury the ones that are.
 */
function wasRevealed(record: MutationRecord): boolean {
  const el = record.target;
  if (!(el instanceof Element) || !isVisible(el)) return false;

  const name = record.attributeName;
  const before = record.oldValue;

  if (name === 'hidden') return before !== null && !el.hasAttribute('hidden');
  if (name === 'aria-hidden') return before === 'true' && el.getAttribute('aria-hidden') !== 'true';
  if (name === 'style') {
    return /display:\s*none|visibility:\s*hidden|opacity:\s*0(?!\.)/i.test(before ?? '');
  }
  return false;
}

function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

export interface Watch {
  /**
   * Close the window now and return what changed. Safe to call twice.
   *
   * `notAfter` drops arrivals first seen at or after that moment: when the
   * window was opened after the pointer already went down, what it is watching
   * is the press's own doing and not a precondition of the step the press is
   * about to become.
   */
  settle(notAfter?: number): PageChange;
}

/**
 * Watch the page until it settles on its own — or until the caller settles it,
 * which is what happens the moment the user performs the next action.
 *
 * `onQuiet` fires only for the former: the page went still by itself and the
 * result is waiting for a step that has not been taken yet.
 */
export function watchPageChange(onQuiet: (change: PageChange) => void): Watch {
  const startedAt = performance.now();
  const requestMark = capturedResponses.length;
  const startUrl = location.href;

  /** Elements seen appearing, still attached as far as we know. */
  const pending = new Set<Element>();
  /** When each of them was first seen, so a caller can cut the window short. */
  const firstSeen = new Map<Element, number>();
  /**
   * What was taken out of the page during the window.
   *
   * A framework re-rendering a list removes each row and adds a new node in its
   * place, and the new one looks exactly like an arrival. It is not: the thing
   * was already on screen, so waiting for it to be visible waits for nothing
   * and passes instantly. Measured on a sorted product list — the generated
   * wait let the next click land while React was still committing, and the
   * click went nowhere.
   */
  const removed = new Set<string>();
  /** Described at the moment they left, while their attributes were still readable. */
  const transient: PickResult[] = [];

  let settled: PageChange | null = null;
  let quietTimer = 0;

  const consider = (node: Node): void => {
    if (!(node instanceof Element) || isNotPageContent(node)) return;
    if (pending.size >= MAX_TRACKED) return;
    if (!isVisible(node)) return;
    pending.add(node);
    if (!firstSeen.has(node)) firstSeen.set(node, Date.now());
  };

  const retire = (node: Node): void => {
    if (!(node instanceof Element)) return;
    if (!isNotPageContent(node)) removed.add(identity(node));
    // Only elements we saw appear — a page tearing down its old view on
    // navigation would otherwise flood this with everything it removed.
    if (!pending.has(node)) return;
    pending.delete(node);
    if (transient.length < MAX_TRACKED) transient.push(describe(node));
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(consider);
      record.removedNodes.forEach(retire);
      if (record.type === 'attributes' && record.target instanceof Element) {
        // An element hidden in place never leaves the tree, but it is gone as
        // far as Wait Until Element Is Not Visible is concerned.
        if (pending.has(record.target) && !isVisible(record.target)) {
          retire(record.target);
        } else if (wasRevealed(record)) {
          consider(record.target);
        }
      }
    }
    restartQuietTimer();
  });

  function finish(quiet: boolean, notAfter = Infinity): PageChange {
    if (settled) return settled;
    clearTimeout(quietTimer);
    clearTimeout(hardStop);
    observer.disconnect();

    const visible = [...pending]
      .filter(isVisible)
      .filter((el) => (firstSeen.get(el) ?? 0) < notAfter);
    // Anything matching something removed in the same window came back rather
    // than arrived, and is no use as a thing to wait for.
    const arrivals = visible.filter((el) => !removed.has(identity(el)));
    const appeared = arrivals.map(describe);
    // And anything that "left" but is on screen right now never left.
    const departures = transient.filter((p) => !stillOnScreen(p));
    const url = location.href !== startUrl ? location.href : undefined;
    settled = {
      appeared,
      appearedEls: arrivals,
      transient: departures,
      requests: capturedResponses.slice(requestMark),
      ...(url ? { url } : {}),
      rerendered: arrivals.length < visible.length || departures.length < transient.length,
      elapsedMs: performance.now() - startedAt,
    };
    if (quiet) onQuiet(settled);
    return settled;
  }

  function restartQuietTimer(): void {
    clearTimeout(quietTimer);
    quietTimer = window.setTimeout(() => finish(true), QUIET_MS);
  }

  const hardStop = window.setTimeout(() => finish(true), MAX_MS);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    // The old value is what makes a reveal legible: without it, an element that
    // is visible now is just an element that is visible now.
    attributeOldValue: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-busy'],
  });
  restartQuietTimer();

  return { settle: (notAfter?: number) => finish(false, notAfter) };
}

export function timeoutFor(change: PageChange): number {
  const slowest = change.requests.reduce((max, r) => Math.max(max, r.durationMs), 0);
  const observed = Math.max(slowest, change.elapsedMs);
  return Math.min(60, Math.max(10, Math.ceil((observed * 3) / 1000)));
}
