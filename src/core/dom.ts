/** DOM helpers that behave correctly across shadow boundaries. */

/** Root of the tree `el` lives in — a ShadowRoot, or the Document. */
export function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

/** querySelectorAll scoped to the element's own tree — not the whole page. */
export function queryInScope(el: Element, selector: string): Element[] {
  try {
    return Array.from(rootOf(el).querySelectorAll(selector));
  } catch {
    return []; // invalid selector — e.g. a class containing unescaped characters
  }
}

/** How many nodes in this element's tree match — 1 means the selector is unique. */
export function countMatches(el: Element, selector: string): number {
  return queryInScope(el, selector).length;
}

export function isUnique(el: Element, selector: string): boolean {
  const hits = queryInScope(el, selector);
  return hits.length === 1 && hits[0] === el;
}

/** CSS.escape with a fallback for older engines. */
export function esc(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** Quote a string for use inside a CSS attribute selector. */
export function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/** Collapse whitespace and trim — page text is full of newlines and padding. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Ancestor chain within the element's own tree, nearest first. */
export function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  let cur = el.parentElement;
  while (cur) {
    out.push(cur);
    cur = cur.parentElement;
  }
  return out;
}

/** 1-based index among siblings sharing the same tag — for :nth-of-type. */
export function nthOfType(el: Element): number {
  let i = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) i++;
    sib = sib.previousElementSibling;
  }
  return i;
}

