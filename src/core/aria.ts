/**
 * A deliberately small subset of the ARIA spec — enough to drive
 * getByRole('button', { name: 'Submit' }), which is the selector style
 * Playwright and Testing Library both recommend.
 *
 * Full accname computation is huge; this covers the ~95% of real pages.
 */
import { normalizeText, labelTextFor, ownText } from './dom';

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link', // only when href is present — handled below
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  footer: 'contentinfo',
  form: 'form',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  header: 'banner',
  img: 'img',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  option: 'option',
  progress: 'progressbar',
  section: 'region',
  select: 'combobox',
  table: 'table',
  textarea: 'textbox',
  td: 'cell',
  th: 'columnheader',
  tr: 'row',
  ul: 'list',
};

const INPUT_TYPE_ROLES: Record<string, string> = {
  button: 'button',
  checkbox: 'checkbox',
  email: 'textbox',
  image: 'button',
  number: 'spinbutton',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  tel: 'textbox',
  text: 'textbox',
  url: 'textbox',
};

export function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0] ?? null;

  const tag = el.tagName.toLowerCase();
  if (tag === 'a' || tag === 'area') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    return INPUT_TYPE_ROLES[type] ?? 'textbox';
  }
  return IMPLICIT_ROLES[tag] ?? null;
}

/** Approximate accessible name, in roughly the order the spec resolves it. */
export function accessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return normalizeText(ariaLabel);

  const fromLabel = labelTextFor(el);
  if (fromLabel) return fromLabel;

  const tag = el.tagName.toLowerCase();
  if (tag === 'img' || (tag === 'input' && el.getAttribute('type') === 'image')) {
    return normalizeText(el.getAttribute('alt'));
  }
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    // For buttons the value *is* the label; for text fields it is user data.
    if (type === 'submit' || type === 'reset' || type === 'button') {
      return normalizeText(el.getAttribute('value'));
    }
    return normalizeText(el.getAttribute('placeholder'));
  }

  const text = normalizeText(el.textContent);
  if (text && text.length <= 80) return text;

  return ownText(el);
}
