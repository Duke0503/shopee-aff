export const tabless = true;
export async function close_tab({ tabid }) {
  await chrome.tabs.remove(tabid);
  return { ok: true };
}
