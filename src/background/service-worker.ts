/**
 * Routes keyboard commands and toolbar clicks to the active tab, and fans picks
 * out to any open devtools panel.
 */
import type { CommandMessage, PageMessage } from '@/shared/protocol';

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
});

chrome.action.onClicked.addListener(() => {
  void sendToActiveTab({ type: 'zelector/toggle-picker' });
});

/** Most recent picks, so a panel opened after the fact still has history. */
const recent: PageMessage[] = [];

chrome.runtime.onMessage.addListener((message: PageMessage, sender) => {
  if (message.type === 'zelector/picked') {
    recent.unshift(message);
    if (recent.length > 50) recent.pop();
    void chrome.storage.session.set({ recent });
  }
  if (message.type === 'zelector/state' && sender.tab?.id) {
    void chrome.action.setBadgeText({
      text: message.frozen ? '❄' : message.picking ? '◎' : '',
      tabId: sender.tab.id,
    });
    void chrome.action.setBadgeBackgroundColor({ color: '#7c5cff', tabId: sender.tab.id });
  }
});
