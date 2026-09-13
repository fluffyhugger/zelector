/**
 * Element construction that survives Trusted Types.
 *
 * Pages sending `Content-Security-Policy: require-trusted-types-for 'script'`
 * — Chrome's New Tab, most Google properties, GitHub, many banking apps — reject
 * every HTML-string sink. Measured against a page serving that header:
 *
 *     innerHTML                     TypeError: requires 'TrustedHTML'
 *     insertAdjacentHTML            TypeError: requires 'TrustedHTML'
 *     DOMParser.parseFromString     TypeError: requires 'TrustedHTML'
 *     createElement + textContent   ok
 *     <style>.textContent           ok, stylesheet applies
 *     adoptedStyleSheets            ok, stylesheet applies
 *     style.cssText / setAttribute  ok
 *
 * So Zelector builds every node by hand. Registering our own TrustedTypePolicy
 * was the other option, but a page may also send a `trusted-types` allowlist that
 * does not include our name — and asking a hardened page to trust us to inject
 * HTML is the wrong shape of fix for a devtool.
 */

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  /** Sets textContent — never parsed as markup, so no escaping is needed. */
  text?: string;
  title?: string;
  hidden?: boolean;
  /** Inline CSS, assigned through style.cssText. */
  style?: string;
  value?: string;
  selected?: boolean;
  data?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Record<string, (event: Event) => void>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.hidden) el.hidden = true;
  if (props.style) el.style.cssText = props.style;
  if (props.value !== undefined && 'value' in el) (el as HTMLInputElement).value = props.value;
  if (props.selected && el instanceof HTMLOptionElement) el.selected = true;

  for (const [key, value] of Object.entries(props.data ?? {})) el.dataset[key] = value;
  for (const [key, value] of Object.entries(props.attrs ?? {})) el.setAttribute(key, value);
  for (const [type, handler] of Object.entries(props.on ?? {})) el.addEventListener(type, handler);

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Replace a node's children with freshly built ones. */
export function replace(target: Element | ShadowRoot, ...children: Child[]): void {
  target.replaceChildren(...children.filter((c): c is Node | string => !!c));
}

/**
 * Attach a stylesheet to a shadow root. Constructable stylesheets are preferred
 * — one parse, shared across roots — with a <style> element as the fallback.
 */
export function applyStyle(root: ShadowRoot, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    root.prepend(style);
  }
}

/** Inline text with <kbd> runs, for the picker hint bar. */
export function kbdLine(...parts: Array<string | string[]>): Array<Node | string> {
  return parts.map((part) => (Array.isArray(part) ? h('kbd', { text: part[0] ?? '' }) : part));
}
