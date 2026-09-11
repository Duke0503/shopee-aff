export const tabless = false;
import { navigate as navto } from '../../background/navigate.js';

export async function navigate(tab, { url, wait = 800, active = false }) {
  await navto(tab.id, url, wait);
  if (active) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  return { ok: true, url };
}
