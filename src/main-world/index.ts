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
import { Recorder } from './recorder';
import { RecPanel } from './rec-panel';
import { isEnvelope, wrap, type CommandMessage, type PageMessage } from '@/shared/protocol';

installHooks();

const hud = new Hud();

const recorder = new Recorder({
  onChange() {
    panel.show(recorder.snapshot());
    send({ type: 'zelector/rec-state', recording: recorder.snapshot() });
  },
  onStateChange() {
    panel.show(recorder.snapshot());
    send({ type: 'zelector/rec-state', recording: recorder.snapshot() });
  },
});

const panel = new RecPanel({
  onStop() {
    if (recorder.isRecording) {
      recorder.stop();
      return; // keep the panel up so the suite can still be copied
    }
    panel.hide();
    recorder.clear();
  },
  onAddAssertion() {
    hud.hide();
    picker.start();
  },
  onName: (name) => recorder.setName(name),
  onDoc: (doc) => recorder.setDoc(doc),
  onClear: () => recorder.clear(),
  onRemove: (id) => recorder.removeStep(id),
  onWait: (id, patch) => recorder.updateWait(id, patch),
  onKeyword: (id, keyword) => recorder.updateKeyword(id, keyword),
});

const picker = new Picker({
  onPick(result) {
    hud.show(result);
    // While recording, the chip row becomes the way to add an assertion.
    hud.setAddStep(
      recorder.isRecording
        ? (keyword) => {
            recorder.addAssert(result, keyword);
            hud.hide();
          }
        : null,
    );
    send({ type: 'zelector/picked', payload: result });
  },
  onCancel() {
    send({ type: 'zelector/cancelled' });
  },
  onStateChange({ picking, frozen }) {
    // Do not record the click that picks an element to assert on.
    recorder.setSuspended(picking);
    send({ type: 'zelector/state', picking, frozen });
  },
});

function send(message: PageMessage): void {
  window.postMessage(wrap(message), '*');
}

function toggleRecorder(): void {
  if (recorder.isRecording) {
    recorder.stop();
  } else {
    picker.stop();
    hud.hide();
    recorder.start();
  }
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
    case 'zelector/toggle-recorder':
      toggleRecorder();
      break;
    case 'zelector/rec-restore':
      // This page replaced the one the flow started on. Pick it back up.
      recorder.restore(message.recording);
      recorder.start();
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
    } else if (event.code === 'KeyR' && event.shiftKey) {
      event.preventDefault();
      toggleRecorder();
    }
  },
  true,
);

send({ type: 'zelector/ready' });
// Only the top frame asks: a recording belongs to the tab, not to each iframe.
if (window === window.top) send({ type: 'zelector/rec-hello' });
