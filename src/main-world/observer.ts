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
  elapsedMs: number;
}

export const emptyChange = (): PageChange => ({
  appeared: [],
  transient: [],
  requests: [],
  elapsedMs: 0,
});

function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/**
 * Watch the page until it settles. Resolves with everything that changed, so
 * the caller can pick a wait that describes the actual behaviour.
 */
export function watchPageChange(): Promise<PageChange> {
  const startedAt = performance.now();
  const requestMark = capturedResponses.length;
  const startUrl = location.href;

  /** Elements seen appearing, still attached as far as we know. */
  const pending = new Set<Element>();
  /** Described at the moment they left, while their attributes were still readable. */
  const transient: PickResult[] = [];

  return new Promise<PageChange>((resolve) => {
    let quietTimer = 0;
    let done = false;

    const consider = (node: Node): void => {
      if (!(node instanceof Element) || isOwnNode(node)) return;
      if (pending.size >= MAX_TRACKED) return;
      if (!isVisible(node)) return;
      pending.add(node);
    };

    const retire = (node: Node): void => {
      if (!(node instanceof Element)) return;
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

    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(quietTimer);
      clearTimeout(hardStop);
      observer.disconnect();

      const appeared = [...pending].filter(isVisible).map(describe);
      const url = location.href !== startUrl ? location.href : undefined;
      resolve({
        appeared,
        transient,
        requests: capturedResponses.slice(requestMark),
        ...(url ? { url } : {}),
        elapsedMs: performance.now() - startedAt,
      });
    };

    function restartQuietTimer(): void {
      clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, QUIET_MS);
    }

    const hardStop = window.setTimeout(finish, MAX_MS);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-busy'],
    });
    restartQuietTimer();
  });
}

/**
 * How long to allow, given how long it actually took. Three times the measured
 * time, floored at 10s — generous enough for a loaded CI box without turning
 * into the 60s default nobody ever tunes.
 */
export function timeoutFor(change: PageChange): number {
  const slowest = change.requests.reduce((max, r) => Math.max(max, r.durationMs), 0);
  const observed = Math.max(slowest, change.elapsedMs);
  return Math.min(60, Math.max(10, Math.ceil((observed * 3) / 1000)));
}
