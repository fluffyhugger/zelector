/**
 * The toolbar popup.
 *
 * Shortcuts are a good accelerator and a terrible front door: someone who
 * installs the extension clicks the icon, and whatever is not there does not
 * exist to them. The recorder is the reason the extension exists, so it gets
 * the first row.
 *
 * The keys shown come from chrome.commands rather than the manifest, so a
 * rebound shortcut shows what the user actually has — and one Chrome could not
 * assign (Alt+Z is taken system-wide by the NVIDIA overlay, among others) shows
 * as missing instead of silently doing nothing.
 */
import type { CommandMessage } from '@/shared/protocol';

const COMMANDS: Record<string, { button: string; kbd: string }> = {
  'toggle-recorder': { button: 'rec', kbd: 'kbd-rec' },
  'toggle-picker': { button: 'pick', kbd: 'kbd-pick' },
  'freeze-dom': { button: 'freeze', kbd: 'kbd-freeze' },
};

const ACTIONS: Record<string, CommandMessage> = {
  rec: { type: 'zelector/toggle-recorder' },
  pick: { type: 'zelector/toggle-picker' },
  freeze: { type: 'zelector/freeze-dom' },
};

const note = document.getElementById('note');

function say(text: string, isError = false, fix = false): void {
  if (!note) return;
  note.textContent = text;
  note.classList.toggle('error', isError);

  // chrome://extensions/shortcuts cannot be linked to — a page may not navigate
  // to a chrome:// URL — but an extension may open one in a tab, and this is
  // the only place someone will be standing when they find out they need it.
  if (!fix) return;
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'fix';
  link.textContent = 'Set them';
  link.addEventListener('click', () => {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });
  note.append(' ', link);
}

/** Alt+Shift+R reads better as the keys people actually press. */
function pretty(shortcut: string): string {
  const mac = navigator.userAgent.includes('Mac');
  if (!mac) return shortcut.replace(/\+/g, ' ');
  return shortcut
    .replace('Command', '⌘')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace('Ctrl', '⌃')
    .replace(/\+/g, ' ');
}

async function showShortcuts(): Promise<void> {
  const commands = await chrome.commands.getAll();
  let missing = 0;

  for (const command of commands) {
    const slot = command.name ? COMMANDS[command.name] : undefined;
    if (!slot) continue;
    const kbd = document.getElementById(slot.kbd);
    if (!kbd) continue;

    if (command.shortcut) {
      kbd.textContent = pretty(command.shortcut);
    } else {
      // Chrome could not assign it: something else already holds the keys.
      kbd.textContent = 'unset';
      kbd.classList.add('unset');
      missing += 1;
    }
  }

  // Unassigned is not the same as broken: the keys are listened for in the page
  // as well, so they work on an ordinary tab whatever Chrome managed to
  // reserve. What is lost is the browser-level shortcut — the one that works
  // while the focus is somewhere else.
  say(
    missing
      ? `${missing} shortcut${missing === 1 ? '' : 's'} could not be assigned — another extension or app got there first. They still work on an ordinary page, and so do the buttons above.`
      : 'Shortcuts work on the page itself, so they keep working even where the toolbar does not.',
    missing > 0,
    missing > 0,
  );
}

async function dispatch(message: CommandMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    window.close();
  } catch {
    // No content script here: chrome:// pages, the Web Store, PDF viewer.
    say('Zelector cannot run on this page. Try an ordinary http(s) tab.', true);
  }
}

for (const [id, message] of Object.entries(ACTIONS)) {
  document.getElementById(id)?.addEventListener('click', () => void dispatch(message));
}

void showShortcuts();
