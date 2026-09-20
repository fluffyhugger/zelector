/**
 * Selenium locator strategy selection.
 *
 * Emitting By.CSS_SELECTOR for everything works, but it is not what a Selenium
 * user writes and it is not what the browser resolves fastest. `By.ID` maps to
 * getElementById; a CSS selector goes through the full selector engine. So pick
 * the narrowest strategy the element actually supports.
 */
import type { PickResult, SelectorCandidate } from './types';

export type ByStrategy =
  | 'ID' | 'NAME' | 'CLASS_NAME' | 'TAG_NAME'
  | 'LINK_TEXT' | 'PARTIAL_LINK_TEXT' | 'CSS_SELECTOR' | 'XPATH';

export interface SeleniumLocator {
  strategy: ByStrategy;
  /** The raw value — an id without '#', a class without '.', etc. */
  value: string;
  note: string;
}

/** Python By.X → the Java builder method of the same strategy. */
const JAVA_METHOD: Record<ByStrategy, string> = {
  ID: 'id',
  NAME: 'name',
  CLASS_NAME: 'className',
  TAG_NAME: 'tagName',
  LINK_TEXT: 'linkText',
  PARTIAL_LINK_TEXT: 'partialLinkText',
  CSS_SELECTOR: 'cssSelector',
  XPATH: 'xpath',
};

export const javaMethod = (s: ByStrategy) => JAVA_METHOD[s];

export function toSeleniumLocator(result: PickResult): SeleniumLocator {
  const best = result.candidates
    .filter((c) => c.engine === 'css')
    .sort((a, b) => b.score - a.score)[0];

  // Follow the scorer's verdict rather than re-deciding here: if it ranked the
  // id below something else, the id is one it distrusts.
  switch (best?.kind) {
    case 'id': {
      const id = result.attributes['id'];
      if (id) return { strategy: 'ID', value: id, note: 'resolves via getElementById — the fastest lookup Selenium has' };
      break;
    }
    case 'name': {
      const name = result.attributes['name'];
      if (name) return { strategy: 'NAME', value: name, note: 'form field name — usually tied to the backend contract' };
      break;
    }
    case 'class': {
      const cls = soleClassOf(best);
      // By.CLASS_NAME takes ONE class name; a compound selector must stay CSS.
      if (cls) return { strategy: 'CLASS_NAME', value: cls, note: '⚠ class-based — will not survive a redesign' };
      break;
    }
  }

  // Selenium is the one target with a first-class link-text strategy. It used
  // to be chosen by comparing scores with a `text` candidate; that candidate
  // was a Playwright expression and is gone. The question it was standing in
  // for is the one robot.ts already asks: does one link on the page read this
  // way, and is what we have otherwise worse than a structural path?
  if (
    result.tagName === 'a' && result.text && result.text.length <= 60 &&
    result.linkTextMatches === 1 && (!best || best.kind === 'path' || best.score < 60)
  ) {
    return { strategy: 'LINK_TEXT', value: result.text, note: '⚠ breaks on copy edits and in other locales' };
  }

  return {
    strategy: 'CSS_SELECTOR',
    value: best?.value ?? result.tagName,
    note: best ? 'no narrower strategy applies to this element' : 'no selector found — falling back to the tag name',
  };
}

/** `div.foo` → `foo`; anything more specific stays a CSS selector. */
function soleClassOf(candidate: SelectorCandidate): string | null {
  const match = /^[a-z][\w-]*\.([\w-]+)$/i.exec(candidate.value);
  return match?.[1] ?? null;
}
