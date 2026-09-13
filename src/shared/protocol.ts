/**
 * Messages crossing the three boundaries:
 *   MAIN world  ──window.postMessage──▶  ISOLATED content script
 *   ISOLATED    ──chrome.runtime──────▶  service worker / devtools panel
 */
import type { PickResult } from '@/core/types';

export const CHANNEL = 'zelector';

export type PageMessage =
  | { type: 'zelector/ready' }
  | { type: 'zelector/picked'; payload: PickResult }
  | { type: 'zelector/cancelled' }
  | { type: 'zelector/state'; picking: boolean; frozen: boolean };

export type CommandMessage =
  | { type: 'zelector/toggle-picker' }
  | { type: 'zelector/freeze-dom' }
  | { type: 'zelector/stop' };

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
