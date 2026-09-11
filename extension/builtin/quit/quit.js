export const tabless = true;
export async function quit() {
  const wins = await chrome.windows.getAll();
  await Promise.all(wins.map(w => chrome.windows.remove(w.id).catch(() => {})));
}
