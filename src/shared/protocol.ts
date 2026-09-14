/**
 * Messages crossing the three boundaries:
 *   MAIN world  ──window.postMessage──▶  ISOLATED content script
 *   ISOLATED    ──chrome.runtime──────▶  service worker / devtools panel
 */
import type { PickResult } from '@/core/types';
import type { RecordedStep, Recording } from '@/core/recording';

export const CHANNEL = 'zelector';

export type PageMessage =
  | { type: 'zelector/ready' }
  | { type: 'zelector/picked'; payload: PickResult }
  | { type: 'zelector/cancelled' }
  | { type: 'zelector/state'; picking: boolean; frozen: boolean }
  /** Full recorder state after every change — the worker is the durable copy. */
  | { type: 'zelector/rec-state'; recording: Recording }
  /** A freshly loaded page asking whether a recording is in progress. */
  | { type: 'zelector/rec-hello' }
  /**
   * A child frame handing its steps to the top frame. Events do not cross a
   * document boundary, so each frame captures its own — but a recording belongs
   * to the tab, and only the top frame talks to the worker.
   */
  | { type: 'zelector/rec-substeps'; steps: RecordedStep[] }
  /** The top frame telling its frames that recording started or stopped. */
  | { type: 'zelector/rec-broadcast'; active: boolean };

export type CommandMessage =
  | { type: 'zelector/toggle-picker' }
  | { type: 'zelector/freeze-dom' }
  | { type: 'zelector/stop' }
  | { type: 'zelector/toggle-recorder' }
  /** Hand a recording back to a page that navigated mid-flow. */
  | { type: 'zelector/rec-restore'; recording: Recording };

/** Commands travel extension → page only; the relay must not echo them back. */
export const COMMAND_TYPES: ReadonlySet<string> = new Set<CommandMessage['type']>([
  'zelector/toggle-picker',
  'zelector/freeze-dom',
  'zelector/stop',
  'zelector/toggle-recorder',
  'zelector/rec-restore',
]);

/**
 * Messages that travel between frames and stop there. The relay must not pass
 * them to the worker: only the top frame's rec-state is the recording.
 */
export const FRAME_ONLY_TYPES: ReadonlySet<string> = new Set([
  'zelector/rec-substeps',
  'zelector/rec-broadcast',
]);

export type AnyMessage = PageMessage | CommandMessage;

export interface Envelope<T = AnyMessage> {
  channel: typeof CHANNEL;
  message: T;
}

export function wrap<T extends AnyMessage>(message: T): Envelope<T> {
  return { channel: CHANNEL, message };
}

export function isEnvelope(data: unknown): data is Envelope {
  return (
    typeof data === 'object' && data !== null &&
    (data as Envelope).channel === CHANNEL &&
    typeof (data as Envelope).message?.type === 'string'
  );
}
