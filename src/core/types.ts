/** How a candidate locates the element. */
export type SelectorKind =
  | 'testid'   // data-testid & friends — the gold standard
  | 'id'       // #foo
  | 'name'     // [name="email"] on form controls
  | 'aria'     // [aria-label="..."]
  | 'attr'     // some other stable attribute (href, type, placeholder…)
  | 'class'    // a class combination unique on the page
  | 'path';    // structural fallback — nth-child chain

/** Target syntax the candidate is written in. */
export type Engine = 'css' | 'xpath';

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
  /**
   * Anchors only: how many links in the same tree carry this text.
   *
   * SeleniumLibrary's `link:` strategy matches on the text, so it is only a
   * locator when the text belongs to one link. A page listing three profiles
   * has three links reading "View profile", and `link:View profile` silently
   * means the first of them.
   */
  linkTextMatches?: number;
  /** Bounding box at pick time, viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number };
  url: string;
  pickedAt: number;
}
