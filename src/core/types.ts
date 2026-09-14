/** How a candidate locates the element. */
export type SelectorKind =
  | 'testid'   // data-testid & friends — the gold standard
  | 'id'       // #foo
  | 'name'     // [name="email"] on form controls
  | 'aria'     // [aria-label="..."]
  | 'role'     // getByRole(role, { name })
  | 'label'    // getByLabel('...')  — input associated with a <label>
  | 'text'     // :has-text('...')
  | 'attr'     // some other stable attribute (href, type, placeholder…)
  | 'class'    // a class combination unique on the page
  | 'path';    // structural fallback — nth-child chain

/** Target syntax the candidate is written in. */
export type Engine = 'css' | 'xpath' | 'playwright';

export interface SelectorCandidate {
  kind: SelectorKind;
  engine: Engine;
  /** The selector string itself. */
  value: string;
  /** 0–100. Higher = more likely to survive a redeploy. */
  score: number;
  /** How many nodes this selector matches right now. */
  matches: number;
  /** Human-readable reasons behind the score — shown in the HUD. */
  notes: string[];
}

/** One hop across a shadow boundary or into an iframe. */
export interface ContextHop {
  type: 'shadow' | 'iframe';
  /** Selector for the host element / frame, within its own context. */
  hostSelector: string;
  /** Shadow roots created with { mode: 'closed' } need the MAIN-world hook. */
  closed?: boolean;
  /**
   * iframe hops only. False when the frame element itself was unreachable —
   * a cross-origin parent — and the selector is a guess from the URL rather
   * than a selector generated against the real element.
   */
  reliable?: boolean;
}

export interface PickResult {
  tagName: string;
  /** Truncated textContent, for display. */
  text: string;
  attributes: Record<string, string>;
  /** Empty when the element sits directly in the top-level document. */
  hops: ContextHop[];
  candidates: SelectorCandidate[];
  /** Bounding box at pick time, viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number };
  url: string;
  pickedAt: number;
}
