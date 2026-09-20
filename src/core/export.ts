/**
 * Turn a pick into code. Each target picks the highest-scoring candidate it can
 * actually express — Selenium has no getByRole(), so it falls back to the best
 * CSS candidate rather than emitting something that will not compile.
 */
import type { PickResult, SelectorCandidate } from './types';
import { toRobotCode, toRobotLocator } from './robot';
import { javaMethod, toSeleniumLocator } from './selenium';

/**
 * What a single pick can be copied as.
 *
 * Robot Framework is what a recording becomes, Selenium is the library it
 * drives, and CSS, XPath and JSON carry no framework with them at all. The
 * tools that were here before — Playwright, Puppeteer, Cypress — ship
 * recorders of their own, and a copy button is not a reason to claim an
 * audience we are not doing the work for.
 */
export type ExportTarget =
  | 'robot' | 'robot-locator'
  | 'selenium-py' | 'selenium-java'
  | 'css' | 'xpath-ish' | 'json';

export const TARGET_LABELS: Record<ExportTarget, string> = {
  robot: 'Robot Framework (SeleniumLibrary)',
  'robot-locator': 'Robot locator only',
  'selenium-py': 'Selenium (Python)',
  'selenium-java': 'Selenium (Java)',
  css: 'CSS selector',
  'xpath-ish': 'XPath',
  json: 'JSON',
};

const best = (list: SelectorCandidate[], engines: SelectorCandidate['engine'][]) =>
  list.filter((c) => engines.includes(c.engine)).sort((a, b) => b.score - a.score)[0];

/** `robotKeyword` selects one of the alternatives from robotActionsFor(); ignored by every other target. */
export function toCode(result: PickResult, target: ExportTarget, robotKeyword?: string): string {
  const cssBest = best(result.candidates, ['css']);
  const shadowNote = result.hops.length
    ? `// ⚠ ${result.hops.length} shadow/frame boundary between this and the document root\n`
    : '';

  switch (target) {
    case 'robot':
      return toRobotCode(result, robotKeyword);

    case 'robot-locator':
      return toRobotLocator(result).value;

    case 'selenium-py': {
      const by = toSeleniumLocator(result);
      return [
        shadowNote.replace('//', '#'),
        `# ${by.note}`,
        `target = driver.find_element(By.${by.strategy}, ${str(by.value)})`,
        'target.click()',
      ].filter(Boolean).join('\n');
    }

    case 'selenium-java': {
      const by = toSeleniumLocator(result);
      return [
        shadowNote,
        `// ${by.note}`,
        `WebElement target = driver.findElement(By.${javaMethod(by.strategy)}(${str(by.value, '"')}));`,
        'target.click();',
      ].filter(Boolean).join('\n');
    }

    case 'css':
      return cssBest?.value ?? '/* no CSS-expressible selector */';

    case 'xpath-ish':
      return toXPath(result);

    case 'json':
      return JSON.stringify(result, null, 2);
  }
}

/** A rough XPath from the element's identity — not a full translation of CSS. */
function toXPath(result: PickResult): string {
  const tag = result.tagName;
  const a = result.attributes;
  for (const key of ['data-testid', 'data-cy', 'data-test', 'id', 'name', 'aria-label']) {
    const v = a[key];
    if (v) return `//${tag}[@${key}="${v}"]`;
  }
  if (result.text && result.text.length <= 40) {
    return `//${tag}[normalize-space(text())="${result.text}"]`;
  }
  return `//${tag}`;
}

function str(value: string, q: '"' | "'" = "'"): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`);
  return `${q}${escaped}${q}`;
}

