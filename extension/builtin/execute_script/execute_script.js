export const tabless = false;
import { cdp } from '../../background/cdp.js';
import { tab_storage } from '../../background/find_tab/tab_storage.js';

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
    let outcome;
    try {
      outcome = await with_timeout(cdp.send(tab.id, 'Runtime.evaluate', {
        expression: code, returnByValue: true, awaitPromise: true,
      }), Math.max(1000, timeout - 1000), 'execute_script_timeout');
    } catch (err) {
      if (/navigated or closed/i.test(err?.message ?? '')) {
        await new Promise(r => setTimeout(r, 1200));
        await cdp.detach(tab.id).catch(() => {});
        tab = await chrome.tabs.get(tab.id);
        await cdp.attach(tab.id);
        outcome = await with_timeout(cdp.send(tab.id, 'Runtime.evaluate', {
          expression: code, returnByValue: true, awaitPromise: true,
        }), Math.max(1000, timeout - 2000), 'execute_script_timeout');
      } else {
        throw err;
      }
    }
    const { result, exceptionDetails } = outcome;
    if (exceptionDetails) throw new Error(
      exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'script error'
    );
    return { result: result?.value ?? null };
  } catch (err) {
    if (/navigated or closed/i.test(err?.message ?? '')) {
      const owned = await tab_storage.get();
      const pruned = Object.fromEntries(Object.entries(owned).filter(([_, tid]) => tid !== tab.id));
      await tab_storage.set(pruned);
    }
    throw err;
  } finally {
    await cdp.detach(tab.id);
  }
}
