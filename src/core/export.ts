/**
 * Turn a pick into code. Each target picks the highest-scoring candidate it can
 * actually express — Selenium has no getByRole(), so it falls back to the best
 * CSS candidate rather than emitting something that will not compile.
 */
import type { PickResult, SelectorCandidate } from './types';
import { toRobotCode, toRobotLocator } from './robot';
import { javaMethod, toSeleniumLocator } from './selenium';

export type ExportTarget =
  | 'robot' | 'robot-locator'
  | 'playwright-ts' | 'playwright-py' | 'selenium-py' | 'selenium-java'
  | 'puppeteer' | 'cypress' | 'css' | 'xpath-ish' | 'json';

export const TARGET_LABELS: Record<ExportTarget, string> = {
  robot: 'Robot Framework (SeleniumLibrary)',
  'robot-locator': 'Robot locator only',
  'playwright-ts': 'Playwright (TS)',
  'playwright-py': 'Playwright (Python)',
  'selenium-py': 'Selenium (Python)',
  'selenium-java': 'Selenium (Java)',
  puppeteer: 'Puppeteer',
  cypress: 'Cypress',
  css: 'CSS selector',
  'xpath-ish': 'XPath',
  json: 'JSON',
};

const best = (list: SelectorCandidate[], engines: SelectorCandidate['engine'][]) =>
  list.filter((c) => engines.includes(c.engine)).sort((a, b) => b.score - a.score)[0];

/** `robotKeyword` selects one of the alternatives from robotActionsFor(); ignored by every other target. */
export function toCode(result: PickResult, target: ExportTarget, robotKeyword?: string): string {
  const anyBest = best(result.candidates, ['css', 'playwright']);
  const cssBest = best(result.candidates, ['css']);
  const shadowNote = result.hops.length
    ? `// ⚠ ${result.hops.length} shadow/frame boundary between this and the document root\n`
    : '';

  switch (target) {
    case 'robot':
      return toRobotCode(result, robotKeyword);

    case 'robot-locator':
      return toRobotLocator(result).value;

    case 'playwright-ts': {
      if (!anyBest) return '// no selector found';
      const expr = anyBest.engine === 'playwright'
        ? `page.${anyBest.value}`
        : `page.locator(${str(anyBest.value)})`;
      return `${shadowNote}const target = ${expr};\nawait target.click();`;
    }

    case 'playwright-py': {
      if (!anyBest) return '# no selector found';
      const expr = anyBest.engine === 'playwright'
        ? `page.${toSnake(anyBest.value)}`
        : `page.locator(${str(anyBest.value)})`;
      return `${shadowNote.replace('//', '#')}target = ${expr}\ntarget.click()`;
    }

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

    case 'puppeteer':
      if (!cssBest) return '// no CSS-expressible selector';
      return `${shadowNote}await page.waitForSelector(${str(cssBest.value)});\nawait page.click(${str(cssBest.value)});`;

    case 'cypress':
      if (!cssBest) return '// no CSS-expressible selector';
      return `${shadowNote}cy.get(${str(cssBest.value)}).click();`;

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

/** getByRole('x', { name: 'y' })  →  get_by_role('x', name='y') */
function toSnake(pwExpr: string): string {
  return pwExpr
    .replace(/^([a-z]+)([A-Z])/, (_, a: string, b: string) => `${a}_${b.toLowerCase()}`)
    .replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a}_${b.toLowerCase()}`)
    .replace(/\{\s*([a-z]+):\s*/g, '$1=')
    .replace(/\s*\}/g, '')
    .replace(/,\s*exact=true/, ', exact=True');
}
