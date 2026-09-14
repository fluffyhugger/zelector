/**
 * Messages crossing the three boundaries:
 *   MAIN world  ──window.postMessage──▶  ISOLATED content script
 *   ISOLATED    ──chrome.runtime──────▶  service worker / devtools panel
 */
import type { PickResult } from '@/core/types';
import type { Recording } from '@/core/recording';

export const CHANNEL = 'zelector';

export type PageMessage =
  | { type: 'zelector/ready' }
  | { type: 'zelector/picked'; payload: PickResult }
  | { type: 'zelector/cancelled' }
  | { type: 'zelector/state'; picking: boolean; frozen: boolean }
  /** Full recorder state after every change — the worker is the durable copy. */
  | { type: 'zelector/rec-state'; recording: Recording }
  /** A freshly loaded page asking whether a recording is in progress. */
  | { type: 'zelector/rec-hello' };

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
