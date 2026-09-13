/**
 * Panel scaffold — a running history of picks. The full Page Map / flow recorder
 * lands here later; for now it proves the message path devtools ⇄ page works.
 */
import type { PageMessage } from '@/shared/protocol';
import type { PickResult } from '@/core/types';

const picks: PickResult[] = [];
const root = document.getElementById('root')!;

document.getElementById('pick')?.addEventListener('click', () => {
  void chrome.tabs.sendMessage(chrome.devtools.inspectedWindow.tabId, { type: 'zelector/toggle-picker' });
});

chrome.runtime.onMessage.addListener((message: PageMessage) => {
  if (message.type !== 'zelector/picked') return;
  picks.unshift(message.payload);
  render();
});

function render(): void {
  if (!picks.length) return;
  root.innerHTML = `<ul>${picks
    .map((p) => {
      const top = p.candidates[0];
      return `<li>
        <div class="head">
          <span class="score">${top?.score ?? '–'}</span>
          <span class="tag">&lt;${escapeHtml(p.tagName)}&gt;</span>
          <time>${new Date(p.pickedAt).toLocaleTimeString()}</time>
        </div>
        <code>${escapeHtml(top?.value ?? '')}</code>
      </li>`;
    })
    .join('')}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
