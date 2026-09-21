/**
 * Runs at document_start in the MAIN world — before any page script.
 *
 * Two things have to be installed this early or they are lost forever:
 *   1. attachShadow, so we keep a handle on shadow roots opened as `closed`.
 *      DevTools shows those as an opaque `#shadow-root (closed)`; we can walk in.
 *   2. fetch / XMLHttpRequest, so every response body is available later when we
 *      map a DOM node back to the JSON field that produced it.
 *   3. alert / confirm / prompt, because a dialog is the one thing a recorder
 *      cannot see any other way. It is browser chrome, not DOM: no element to
 *      pick, no event to listen for. A recording that walks past one produces a
 *      suite that hangs on the dialog it never mentions.
 */

/** Closed roots, keyed by host. WeakMap so we never keep detached trees alive. */
const closedRoots = new WeakMap<Element, ShadowRoot>();

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
  installDialogHook();
}

/** What a dialog asked, and what the person answered. */
export interface DialogEvent {
  kind: 'alert' | 'confirm' | 'prompt';
  message: string;
  /** confirm: dismissed. prompt: cancelled. */
  accepted: boolean;
  /** prompt only — what was typed in. */
  text?: string;
}

type DialogListener = (event: DialogEvent) => void;
const dialogListeners = new Set<DialogListener>();

export function onDialog(listener: DialogListener): () => void {
  dialogListeners.add(listener);
  return () => dialogListeners.delete(listener);
}

/**
 * These block the page, so the listeners run after the person has answered and
 * before the page sees the answer — which puts the step in the right place
 * without any ordering work at the other end.
 */
function installDialogHook(): void {
  const announce = (event: DialogEvent): void => {
    for (const listener of dialogListeners) {
      try {
        listener(event);
      } catch {
        // A listener that throws must not break the page's own dialog.
      }
    }
  };

  const alertOriginal = window.alert;
  if (alertOriginal && !(alertOriginal as { __zelector?: boolean }).__zelector) {
    const patched = function (this: unknown, message?: unknown): void {
      alertOriginal.call(window, message as string);
      announce({ kind: 'alert', message: String(message ?? ''), accepted: true });
    } as typeof window.alert;
    (patched as { __zelector?: boolean }).__zelector = true;
    window.alert = patched;
  }

  const confirmOriginal = window.confirm;
  if (confirmOriginal && !(confirmOriginal as { __zelector?: boolean }).__zelector) {
    const patched = function (this: unknown, message?: unknown): boolean {
      const accepted = confirmOriginal.call(window, message as string);
      announce({ kind: 'confirm', message: String(message ?? ''), accepted });
      return accepted;
    } as typeof window.confirm;
    (patched as { __zelector?: boolean }).__zelector = true;
    window.confirm = patched;
  }

  const promptOriginal = window.prompt;
  if (promptOriginal && !(promptOriginal as { __zelector?: boolean }).__zelector) {
    const patched = function (this: unknown, message?: unknown, fallback?: unknown): string | null {
      const answer = promptOriginal.call(window, message as string, fallback as string);
      announce({
        kind: 'prompt',
        message: String(message ?? ''),
        accepted: answer !== null,
        ...(answer === null ? {} : { text: answer }),
      });
      return answer;
    } as typeof window.prompt;
    (patched as { __zelector?: boolean }).__zelector = true;
    window.prompt = patched;
  }
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
