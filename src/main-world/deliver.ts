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

export async function copy(text: string, button: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    flash(button, '✓');
  } catch {
    flash(button, '✕'); // clipboard can be blocked without a user gesture
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
