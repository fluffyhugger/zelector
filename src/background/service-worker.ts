/**
 * Routes keyboard commands and toolbar clicks to the active tab, fans picks out
 * to any open devtools panel, and holds the recording.
 *
 * The recording lives here rather than in the page because a flow that never
 * leaves one URL is not a flow worth recording — a login, a checkout, anything
 * real navigates, and navigation destroys the MAIN world along with everything
 * in it. The worker keeps the steps and hands them back when the new page says
 * hello. chrome.storage.session, not a module variable: MV3 stops the worker
 * whenever it feels like it.
 */
import type { CommandMessage, PageMessage } from '@/shared/protocol';
import { emptyRecording, type Recording } from '@/core/recording';

async function sendToActiveTab(message: CommandMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Content script not injected here — chrome:// pages, the Web Store, PDFs.
    await chrome.action.setBadgeText({ text: '×', tabId: tab.id });
    setTimeout(() => void chrome.action.setBadgeText({ text: '', tabId: tab.id }), 1500);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-picker') void sendToActiveTab({ type: 'zelector/toggle-picker' });
  if (command === 'freeze-dom') void sendToActiveTab({ type: 'zelector/freeze-dom' });
  if (command === 'toggle-recorder') void sendToActiveTab({ type: 'zelector/toggle-recorder' });
});

// No chrome.action.onClicked handler: the toolbar icon opens popup.html, which
// dispatches to the tab itself. A listener here would never fire.

/** Most recent picks, so a panel opened after the fact still has history. */
const recent: PageMessage[] = [];

interface Session {
  tabId: number;
  recording: Recording;
}

let session: Session | null = null;
let hydrated = false;

/** The worker may have been restarted since the recording started. */
async function load(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const stored = await chrome.storage.session.get('session');
  if (stored['session']) session = stored['session'] as Session;
}

async function save(): Promise<void> {
  await chrome.storage.session.set({ session });
}

async function setRecordingBadge(tabId: number, active: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: active ? '⏺' : '', tabId });
  await chrome.action.setBadgeBackgroundColor({ color: active ? '#f87171' : '#7c5cff', tabId });
}

chrome.runtime.onMessage.addListener((message: PageMessage, sender) => {
  const tabId = sender.tab?.id;

  if (message.type === 'zelector/picked') {
    recent.unshift(message);
    if (recent.length > 50) recent.pop();
    void chrome.storage.session.set({ recent });
  }

  if (message.type === 'zelector/state' && tabId !== undefined) {
    // A live recording owns the badge; picking must not clear it.
    if (session?.tabId === tabId && session.recording.active) return;
    void chrome.action.setBadgeText({
      text: message.frozen ? '❄' : message.picking ? '◎' : '',
      tabId,
    });
    void chrome.action.setBadgeBackgroundColor({ color: '#7c5cff', tabId });
  }

  if (message.type === 'zelector/rec-state' && tabId !== undefined) {
    void (async () => {
      await load();
      session = { tabId, recording: message.recording };
      await save();
      await setRecordingBadge(tabId, message.recording.active);
    })();
  }

  if (message.type === 'zelector/rec-hello' && tabId !== undefined) {
    void (async () => {
      await load();
      if (session?.tabId !== tabId || !session.recording.active) return;
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'zelector/rec-restore',
          recording: session.recording,
        } satisfies CommandMessage);
      } catch {
        // The page went away again before it could be told.
      }
    })();
  }
});

/** A closed tab takes its recording with it. */
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await load();
    if (session?.tabId !== tabId) return;
    session = { tabId, recording: emptyRecording() };
    await save();
  })();
});
