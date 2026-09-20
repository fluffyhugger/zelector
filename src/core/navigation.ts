/**
 * Did the step before this navigation cause it?
 *
 * The recorder used to answer with a stopwatch alone: a navigation within two
 * and a half seconds of a step was that step's doing, and anything later was
 * someone typing in the address bar. That holds until the site is slow.
 * data.go.th took longer than the grace to load, so a recording of two clicked
 * links came out as click, Go To, click, Go To — each click navigating, and
 * each navigation then done a second time by hand. The replay reloads the page
 * it just arrived at, which is how the cookie banner got a second chance to
 * animate into the path of the next click.
 *
 * A link says where it was going. When it matches where the page now is, no
 * stopwatch is needed.
 */
export function linkLedTo(
  link: { href?: string; from?: string } | undefined,
  url: string,
): boolean {
  if (!link?.href) return false;
  try {
    return sameTarget(new URL(link.href, link.from || url).href, url);
  } catch {
    return false;
  }
}

/**
 * Same page, allowing for the things a server rewrites on the way: a trailing
 * slash it adds, and a fragment the browser keeps to itself.
 */
function sameTarget(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

const normalise = (raw: string): string => {
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return raw;
  }
};
