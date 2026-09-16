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
import { isOwnNode } from './ignore';
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
  return `${el.tagName}#${el.id}[${test}].${el.className}:${attrs.length}`;
}

function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

export interface Watch {
  /** Close the window now and return what changed. Safe to call twice. */
  settle(): PageChange;
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
    if (!(node instanceof Element) || isOwnNode(node)) return;
    if (pending.size >= MAX_TRACKED) return;
    if (!isVisible(node)) return;
    pending.add(node);
  };

  const retire = (node: Node): void => {
    if (!(node instanceof Element)) return;
    if (!isOwnNode(node)) removed.add(identity(node));
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
      // An element hidden in place never leaves the tree, but it is gone as
      // far as Wait Until Element Is Not Visible is concerned.
      if (record.type === 'attributes' && record.target instanceof Element) {
        if (pending.has(record.target) && !isVisible(record.target)) retire(record.target);
      }
    }
    restartQuietTimer();
  });

  function finish(quiet: boolean): PageChange {
    if (settled) return settled;
    clearTimeout(quietTimer);
    clearTimeout(hardStop);
    observer.disconnect();

    const visible = [...pending].filter(isVisible);
    // Anything matching something removed in the same window came back rather
    // than arrived, and is no use as a thing to wait for.
    const arrivals = visible.filter((el) => !removed.has(identity(el)));
    const appeared = arrivals.map(describe);
    const url = location.href !== startUrl ? location.href : undefined;
    settled = {
      appeared,
      transient,
      requests: capturedResponses.slice(requestMark),
      ...(url ? { url } : {}),
      rerendered: arrivals.length < visible.length,
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
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-busy'],
  });
  restartQuietTimer();

  return { settle: () => finish(false) };
}

export function timeoutFor(change: PageChange): number {
  const slowest = change.requests.reduce((max, r) => Math.max(max, r.durationMs), 0);
  const observed = Math.max(slowest, change.elapsedMs);
  return Math.min(60, Math.max(10, Math.ceil((observed * 3) / 1000)));
}
