export async function exec(tabId, func, ...args) {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (frame.exceptionDetails) throw new Error(frame.exceptionDetails.text ?? 'executeScript failed');
  return frame.result;
}
