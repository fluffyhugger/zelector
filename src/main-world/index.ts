/**
 * MAIN-world entry point.
 *
 * Everything that touches the page's DOM lives here rather than in the isolated
 * content script, because only the MAIN world can see shadow roots opened as
 * `closed` — and patching attachShadow has to happen before the page's first
 * script runs, which is why this is a document_start content script.
 *
 * chrome.* is unavailable here, so we talk to the extension through
 * window.postMessage and let content.js relay.
 */
import { installHooks } from './hooks';
import { Picker } from './picker';
import { Hud } from './hud';
import { isEnvelope, wrap, type CommandMessage, type PageMessage } from '@/shared/protocol';

installHooks();

const hud = new Hud();

const picker = new Picker({
  onPick(result) {
    hud.show(result);
    send({ type: 'zelector/picked', payload: result });
  },
  onCancel() {
    send({ type: 'zelector/cancelled' });
  },
  onStateChange({ picking, frozen }) {
    send({ type: 'zelector/state', picking, frozen });
  },
});

function send(message: PageMessage): void {
  window.postMessage(wrap(message), '*');
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !isEnvelope(event.data)) return;
  const message = event.data.message as CommandMessage;
  switch (message.type) {
    case 'zelector/toggle-picker':
      hud.hide();
      picker.toggle();
      break;
    case 'zelector/freeze-dom':
      // Freezing implies picking — there is nothing to freeze for otherwise.
      if (!picker.isPicking) picker.start();
      picker.toggleFreeze();
      break;
    case 'zelector/stop':
      picker.stop();
      hud.hide();
      break;
  }
});

// Alt+Z also works without the service worker (e.g. on pages where the command
// shortcut is taken by the site) because we listen in the page itself.
//
// Match on event.code, not event.key. Option is a compose modifier on macOS, so
// Option+Z reports key === 'Ω' and Option+Shift+F reports 'Ï'; a non-Latin
// keyboard layout shifts event.key too. event.code is the physical key either way.
window.addEventListener(
  'keydown',
  (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'KeyZ' && !event.shiftKey) {
      event.preventDefault();
      hud.hide();
      picker.toggle();
    } else if (event.code === 'KeyF' && event.shiftKey) {
      event.preventDefault();
      if (!picker.isPicking) picker.start();
      picker.toggleFreeze();
    }
  },
  true,
);

send({ type: 'zelector/ready' });
