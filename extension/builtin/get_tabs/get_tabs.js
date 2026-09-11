export const tabless = true;
export async function get_tabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(({ id, windowId, url, title, active, pinned }) => ({ id, windowId, url, title, active, pinned }));
}
