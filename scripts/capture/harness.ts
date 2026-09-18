/**
 * The recorder, in a page, with no extension around it.
 *
 * Nothing in the capture layer touches chrome.*, so it can be bundled into an
 * ordinary page and driven by a real browser. That matters more than it might
 * sound: every bug this suite exists to catch came from the difference between
 * what an event says and what the page had already done about it — label
 * activation arriving twice, a calendar opening on focus before the click,
 * a menu under the cursor by the time the click lands. A fake DOM has none of
 * that, so the tests are driven with real input through WebDriver.
 */
import { installHooks } from '@/main-world/hooks';
import { Recorder } from '@/main-world/recorder';
import type { RecordedStep } from '@/core/recording';
import { actionForStep } from '@/core/recording';
import { toRobotLocator } from '@/core/robot';

installHooks();

/** What a test asserts against: one readable line per step. */
interface Summary {
  keyword: string;
  locator: string;
  value?: string;
  wait: string;
  waitTarget?: string;
  reason: string;
}

const summarise = (step: RecordedStep): Summary => ({
  keyword: actionForStep(step).keyword,
  locator: toRobotLocator(step.target).value,
  ...(step.value === undefined ? {} : { value: step.value }),
  wait: step.wait.kind,
  ...(step.wait.target ? { waitTarget: toRobotLocator(step.wait.target).value } : {}),
  reason: step.wait.reason,
});

const recorder = new Recorder({
  onChange(steps) {
    (window as unknown as Record<string, unknown>).__steps = steps.map(summarise);
  },
  onStateChange() {},
});

Object.assign(window as unknown as Record<string, unknown>, {
  __zelector: {
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    steps: () => recorder.snapshot().steps.map(summarise),
  },
  __steps: [],
});
