export const tabless = true;
export async function switch_tab({ tabid }) {
  const tab = await chrome.tabs.update(tabid, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  return { ok: true };
}
