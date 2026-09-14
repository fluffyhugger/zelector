/**
 * Isolated-world bridge. Holds no DOM logic — it only relays between the page
 * (window.postMessage) and the extension (chrome.runtime), which the MAIN world
 * cannot reach.
 */
import { COMMAND_TYPES, isEnvelope, wrap, type CommandMessage, type PageMessage } from '@/shared/protocol';

// page → extension
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !isEnvelope(event.data)) return;
  const message = event.data.message;
  if (!message.type.startsWith('zelector/')) return;
  // Commands travel the other way; do not echo them back.
  if (COMMAND_TYPES.has(message.type)) return;

  chrome.runtime.sendMessage(message as PageMessage).catch(() => {
    // No receiver (panel closed, worker asleep) — nothing to do.
  });
});

// extension → page
chrome.runtime.onMessage.addListener((message: CommandMessage) => {
  if (typeof message?.type === 'string' && message.type.startsWith('zelector/')) {
    window.postMessage(wrap(message), '*');
  }
});
