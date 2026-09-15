/**
 * Isolated-world bridge. Holds no DOM logic — it only relays between the page
 * (window.postMessage) and the extension (chrome.runtime), which the MAIN world
 * cannot reach.
 */
import {
  COMMAND_TYPES,
  FRAME_ONLY_TYPES,
  isEnvelope,
  wrap,
  type CommandMessage,
  type PageMessage,
} from '@/shared/protocol';

// page → extension
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !isEnvelope(event.data)) return;
  const message = event.data.message;
  if (!message.type.startsWith('zelector/')) return;
  // Commands travel the other way; do not echo them back.
  if (COMMAND_TYPES.has(message.type)) return;
  // Frame-to-frame traffic is none of the worker's business.
  if (FRAME_ONLY_TYPES.has(message.type)) return;

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

/**
 * Ask whether a recording survived the navigation that brought us here.
 *
 * This has to come from the relay, not from the page. The MAIN world runs at
 * document_start and this runs at document_idle, and window.postMessage is not
 * buffered — anything the page sent before this listener existed is simply
 * gone. So the later script starts the handshake, by which point both worlds
 * are up.
 *
 * Only the top frame asks: a recording belongs to the tab.
 */
if (window === window.top) {
  chrome.runtime.sendMessage({ type: 'zelector/rec-hello' } satisfies PageMessage).catch(() => {
    // Worker asleep with nothing to say; there is no recording to lose.
  });
}
