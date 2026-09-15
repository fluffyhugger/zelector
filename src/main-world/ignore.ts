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

  // Walk out through any shadow boundaries first. contains() stops at one, and
  // a node handed to us directly — rather than through an event, which would
  // have been retargeted to the host — is otherwise unrecognisable as ours.
  let node: Node | null = target;
  let guard = 0;
  while (node && guard++ < 32) {
    for (const host of ownHosts) {
      if (host === node || host.contains(node)) return true;
    }
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}
