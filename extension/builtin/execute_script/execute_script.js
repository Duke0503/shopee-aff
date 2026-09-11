export const tabless = false;
import { cdp } from '../../background/cdp.js';

function with_timeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function execute_script(tab, { code, tabid, _job_timeout_ms }) {
  if (tabid != null) tab = await chrome.tabs.get(Number(tabid));
  const timeout = Math.max(1000, Number(_job_timeout_ms ?? 30_000) || 30_000);
  await cdp.attach(tab.id);
  try {
    const { result, exceptionDetails } = await with_timeout(cdp.send(tab.id, 'Runtime.evaluate', {
      expression: code, returnByValue: true, awaitPromise: true,
    }), Math.max(1000, timeout - 1000), 'execute_script_timeout');
    if (exceptionDetails) throw new Error(
      exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'script error'
    );
    return { result: result?.value ?? null };
  } finally {
    await cdp.detach(tab.id);
  }
}
