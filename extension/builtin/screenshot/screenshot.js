export const tabless = false;
// Captures a screenshot of the tab this extension owns.
// captureVisibleTab requires the tab to be active AND the window to be focused on screen.
export async function screenshot(tab, { tabid } = {}) {
  if (tabid != null) tab = await chrome.tabs.get(Number(tabid));
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  await new Promise(r => setTimeout(r, 300)); // let rendering settle
  const dataurl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return { dataurl };
}
