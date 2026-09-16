/**
 * Nodes that are not the page's business — ours, and other extensions'.
 *
 * The picker must never highlight its own overlay, and the freeze blocker must
 * never swallow clicks on its own panel.
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

/**
 * Markup another extension put there.
 *
 * A recording made with Google Translate running came back waiting for
 * `id:gtx-trans` to be visible, which it never is anywhere else — the suite
 * failed on the first clean browser it met. Grammarly, the password managers
 * and the shopping extensions all decorate pages the same way, and none of it
 * belongs in a test of the page.
 *
 * A list rather than a heuristic, because there is no honest way to tell
 * injected markup from a page's own without one: plenty of sites legitimately
 * append absolutely-positioned custom elements to the body.
 */
const FOREIGN = [
  // Google Translate. Not `.skiptranslate`: that is a class pages put on their
  // own markup to opt out of translation, so matching it hands whole sections
  // of a perfectly ordinary site to this list.
  'gtx-trans', '#gtx-trans', '.gtx-trans-icon', 'font[_msttexthash]',
  // Grammarly
  'grammarly-extension', 'grammarly-desktop-integration', '[data-grammarly-shadow-root]',
  // LastPass
  '[data-lastpass-icon-root]', '[data-lastpass-root]', '[id^="__lpform"]',
  // 1Password, Dashlane, Bitwarden
  'com-1password-button', '[data-com-onepassword-filled]',
  '[data-dashlane-rid]', '[data-dashlane-label]', '[data-bw-watermark]',
  // Honey, MetaMask, Loom
  '#honeyContainer', '#metamask-extension', '[id^="loom-"]',
].join(',');

export function isForeignNode(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return !!target.closest(FOREIGN);
  } catch {
    return false; // a selector this engine dislikes should not stop a recording
  }
}

/** Ours, or another extension's — either way, not part of the page under test. */
export function isNotPageContent(target: EventTarget | null): boolean {
  return isOwnNode(target) || isForeignNode(target);
}
