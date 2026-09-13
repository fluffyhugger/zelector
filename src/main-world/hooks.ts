/**
 * Runs at document_start in the MAIN world — before any page script.
 *
 * Two things have to be installed this early or they are lost forever:
 *   1. attachShadow, so we keep a handle on shadow roots opened as `closed`.
 *      DevTools shows those as an opaque `#shadow-root (closed)`; we can walk in.
 *   2. fetch / XMLHttpRequest, so every response body is available later when we
 *      map a DOM node back to the JSON field that produced it.
 */

/** Closed roots, keyed by host. WeakMap so we never keep detached trees alive. */
export const closedRoots = new WeakMap<Element, ShadowRoot>();

export interface CapturedResponse {
  id: number;
  method: string;
  url: string;
  status: number;
  startedAt: number;
  durationMs: number;
  /** Parsed JSON when the body was JSON; undefined otherwise. */
  json?: unknown;
}

export const capturedResponses: CapturedResponse[] = [];
const MAX_CAPTURES = 200;
let captureSeq = 0;

export function installHooks(): void {
  installShadowHook();
  installFetchHook();
  installXhrHook();
}

function installShadowHook(): void {
  const original = Element.prototype.attachShadow;
  if (!original || (original as { __zelector?: boolean }).__zelector) return;

  const patched = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = original.call(this, init);
    if (init.mode === 'closed') closedRoots.set(this, root);
    return root;
  } as typeof Element.prototype.attachShadow;

  (patched as { __zelector?: boolean }).__zelector = true;
  Element.prototype.attachShadow = patched;
}

/** The shadow root of `el`, open or closed. */
export function shadowRootOf(el: Element): ShadowRoot | null {
  return el.shadowRoot ?? closedRoots.get(el) ?? null;
}

export function isClosedShadowHost(el: Element): boolean {
  return !el.shadowRoot && closedRoots.has(el);
}

function record(entry: Omit<CapturedResponse, 'id'>): void {
  capturedResponses.push({ id: ++captureSeq, ...entry });
  if (capturedResponses.length > MAX_CAPTURES) capturedResponses.shift();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function installFetchHook(): void {
  const original = window.fetch;
  if (!original || (original as { __zelector?: boolean }).__zelector) return;

  const patched = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const startedAt = performance.now();
    const response = await original.apply(this, args);
    // Reading the body consumes it — clone first so the page still gets its data.
    void response
      .clone()
      .text()
      .then((text) => {
        const json = parseJson(text);
        if (json === undefined) return; // not JSON; nothing to map fields from
        record({
          method: (args[1]?.method ?? (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase(),
          url: response.url,
          status: response.status,
          startedAt,
          durationMs: performance.now() - startedAt,
          json,
        });
      })
      .catch(() => {}); // a body we cannot read is simply not captured
    return response;
  } as typeof fetch;

  (patched as { __zelector?: boolean }).__zelector = true;
  window.fetch = patched;
}

function installXhrHook(): void {
  const proto = XMLHttpRequest.prototype;
  if ((proto.open as { __zelector?: boolean }).__zelector) return;

  const originalOpen = proto.open;
  const originalSend = proto.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string; startedAt: number }>();

  const open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    meta.set(this, { method: method.toUpperCase(), url: String(url), startedAt: 0 });
    // @ts-expect-error — forwarding the original variadic signature
    return originalOpen.call(this, method, url, ...rest);
  };
  (open as { __zelector?: boolean }).__zelector = true;
  proto.open = open as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, ...args: Parameters<typeof originalSend>) {
    const info = meta.get(this);
    if (info) {
      info.startedAt = performance.now();
      this.addEventListener('load', () => {
        if (typeof this.responseText !== 'string') return;
        const json = parseJson(this.responseText);
        if (json === undefined) return;
        record({
          method: info.method,
          url: new URL(info.url, location.href).href,
          status: this.status,
          startedAt: info.startedAt,
          durationMs: performance.now() - info.startedAt,
          json,
        });
      });
    }
    return originalSend.apply(this, args);
  };
}
