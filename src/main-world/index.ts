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

/**
 * A recording belongs to the tab, but events never cross a document boundary,
 * so every frame has to capture its own. Only the top frame owns the state:
 * it shows the panel and talks to the worker, while frames below it forward
 * what they caught and stay quiet.
 */
const IS_TOP = window === window.top;

const hud = new Hud();

const recorder = new Recorder({
  onChange(steps) {
    if (!IS_TOP) {
      postUp({ type: 'zelector/rec-substeps', steps });
      return;
    }
    panel.show(recorder.snapshot());
    send({ type: 'zelector/rec-state', recording: recorder.snapshot() });
  },
  onStateChange() {
    if (!IS_TOP) return;
    panel.show(recorder.snapshot());
    send({ type: 'zelector/rec-state', recording: recorder.snapshot() });
  },
});

const panel = new RecPanel({
  onStop() {
    if (recorder.isRecording) {
      // Not recorder.stop(): the frames below are recording too, and only
      // setRecording tells them.
      setRecording(false);
      return; // keep the panel up so the suite can still be copied
    }
    // clear() before hide(), because clearing emits and an emit re-mounts the
    // panel — hiding first meant it came straight back.
    recorder.clear();
    panel.hide();
  },
  onAddAssertion() {
    hud.hide();
    picker.start();
  },
  onUi: (ui) => recorder.setUi(ui),
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

/** Hand something to the frame above. Cross-origin parents accept this too. */
function postUp(message: PageMessage): void {
  try {
    window.parent.postMessage(wrap(message), '*');
  } catch {
    // A parent that will not take the message simply loses those steps.
  }
}

/**
 * The command from the worker reaches every frame on its own, but the in-page
 * shortcut only fires in the frame that has focus — so the top frame passes it
 * down, and each frame passes it down again.
 */
function broadcastDown(active: boolean): void {
  for (let i = 0; i < window.frames.length; i += 1) {
    try {
      window.frames[i]?.postMessage(wrap({ type: 'zelector/rec-broadcast', active }), '*');
    } catch {
      // Nothing to do about a frame that refuses to listen.
    }
  }
}

function setRecording(active: boolean): void {
  if (active === recorder.isRecording) return;
  if (active) {
    picker.stop();
    hud.hide();
    recorder.start();
  } else {
    recorder.stop();
  }
  broadcastDown(active);
}

function toggleRecorder(): void {
  setRecording(!recorder.isRecording);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (!isEnvelope(event.data)) return;

  // Frame traffic arrives from another window, so it is handled before the
  // same-window check that everything else depends on.
  const framed = event.data.message as PageMessage;
  if (framed.type === 'zelector/rec-substeps') {
    if (IS_TOP && recorder.isRecording) recorder.acceptForeignSteps(framed.steps);
    return;
  }
  if (framed.type === 'zelector/rec-broadcast') {
    setRecording(framed.active);
    return;
  }
  // A frame that loaded late — lazy iframe, or one replaced mid-flow — asking
  // whether it should be capturing.
  if (framed.type === 'zelector/rec-hello' && event.source !== window) {
    if (recorder.isRecording && event.source) {
      (event.source as Window).postMessage(wrap({ type: 'zelector/rec-broadcast', active: true }), '*');
    }
    return;
  }

  if (event.source !== window) return;
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
      // The command reaches every frame at once, but only the top frame decides:
      // a frame acting on it too would toggle twice and land on the wrong state.
      if (IS_TOP) toggleRecorder();
      break;
    case 'zelector/rec-restore':
      // This page replaced the one the flow started on. Pick it back up.
      if (!IS_TOP) break;
      recorder.restore(message.recording);
      setRecording(true);
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
// The top frame does NOT ask the worker from here: this runs at document_start
// and the relay that would carry the question does not exist until
// document_idle, so the question was being dropped on the floor and a recording
// never survived a navigation. content.js asks on its own behalf instead.
//
// Frame to frame is a different matter — the parent has been listening since
// its own document_start, so a late-loading frame can ask it directly.
if (!IS_TOP) postUp({ type: 'zelector/rec-hello' });
