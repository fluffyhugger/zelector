/**
 * Handing the result to the user.
 *
 * Both run in the MAIN world, which is page context — so navigator.clipboard is
 * governed by the page's permissions policy and a user gesture, not by any
 * extension permission. Nothing here needs `clipboardWrite` or `downloads`.
 */
import { h } from './dom-build';

/** Flash the button so a click that worked looks like it worked. */
function flash(button: HTMLElement, mark: string): void {
  const original = button.textContent;
  button.textContent = mark;
  setTimeout(() => {
    button.textContent = original;
  }, 900);
}

/**
 * The old way first, deliberately.
 *
 * navigator.clipboard.writeText is the modern answer and it is the one that
 * fails here: it is gated on the document being focused and on a
 * Permissions-Policy the page controls, and it reports either by rejecting a
 * promise — by which time the user gesture is over and there is no second
 * chance. execCommand is deprecated and works: it is synchronous, so it runs
 * inside the click that asked for it, and it does not care whose page this is.
 */
export function copy(text: string, button: HTMLElement): void {
  if (execCopy(text)) {
    flash(button, '✓');
    return;
  }
  navigator.clipboard?.writeText(text).then(
    () => flash(button, '✓'),
    () => flash(button, '✕'),
  );
}

/**
 * A textarea in the light DOM, selected and copied.
 *
 * It has to sit outside our closed shadow root: execCommand works on the
 * document's selection, and a selection inside a closed root is not one the
 * document can see.
 *
 * Two things the page can do to break this, and both are done by real sites:
 *
 * `user-select: none` applied broadly means select() produces no selection and
 * execCommand has nothing to copy — so the rule is overridden on our own
 * element, with !important, because that is what it is competing with.
 *
 * And a page may listen for the copy event and replace or cancel it. Ours
 * listens first, in the capture phase, writes the text straight onto the
 * clipboard and stops the event there. That also means the copied text never
 * depends on what the selection actually contains.
 */
function execCopy(text: string): boolean {
  const area = h('textarea');
  for (const [prop, value] of [
    ['position', 'fixed'], ['top', '0'], ['left', '0'],
    ['width', '1px'], ['height', '1px'], ['padding', '0'], ['border', '0'],
    ['opacity', '0'], ['user-select', 'text'], ['-webkit-user-select', 'text'],
  ]) {
    area.style.setProperty(prop!, value!, 'important');
  }
  area.value = text;
  area.setAttribute('readonly', '');
  (document.documentElement || document.body).appendChild(area);

  const onCopy = (event: Event): void => {
    const clipboardData = (event as ClipboardEvent).clipboardData;
    if (!clipboardData) return;
    clipboardData.setData('text/plain', text);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const previous = document.activeElement;
  document.addEventListener('copy', onCopy, true);
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    area.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}

/**
 * A blob URL behind a download anchor, rather than chrome.downloads — that API
 * would add a "Manage your downloads" warning to the install prompt, which is a
 * lot to ask for a button that hands over a text file.
 */
export function download(text: string, filename: string, button: HTMLElement): void {
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = h('a', { attrs: { href: url, download: filename } });
    // Detached anchors do not reliably fire in every engine.
    (document.documentElement || document.body).appendChild(anchor);
    anchor.click();
    anchor.remove();
    flash(button, '✓');
  } catch {
    // A page whose CSP refuses blob: navigation. Copy still works.
    flash(button, '✕');
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** "Pay With Card" → "pay_with_card.robot" */
export function robotFilename(name: string | undefined): string {
  const slug = (name ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  return `${slug || 'recorded_flow'}.robot`;
}
