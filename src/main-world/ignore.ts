/**
 * Nodes belonging to Zelector itself. The picker must never highlight its own
 * overlay, and the freeze blocker must never swallow clicks on its own panel.
 * Both UIs use closed shadow roots, so `contains()` on the host is enough.
 */
const ownHosts = new Set<Element>();

export function registerOwnHost(el: Element): void {
  ownHosts.add(el);
}

export function unregisterOwnHost(el: Element): void {
  ownHosts.delete(el);
}

export function isOwnNode(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  for (const host of ownHosts) {
    if (host === target || host.contains(target)) return true;
  }
  return false;
}
