export const tabless = true;
export async function reload() {
  setTimeout(() => chrome.runtime.reload(), 300);
  return { reloading: true };
}
