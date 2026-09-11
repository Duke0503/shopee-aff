import { cdp } from './cdp.js';

function with_timeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Resolve navigation as soon as the DOM is ready (DOMContentLoaded). Heavy pages
// can keep loading trackers/ads/long-poll connections and may never reach the full
// 'load'/'complete' state. The DOM is ready well before that, which is all callers
// need for generic browser actions. The cap resolves with whatever rendered.
function wait_dom_ready(tabId, cap = 15_000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; cleanup(); resolve(); };
    const timer  = setTimeout(finish, cap);
    function cleanup() {
      clearTimeout(timer);
      cdp.off(tabId, 'Page.domContentEventFired', finish);
      cdp.off(tabId, 'Page.loadEventFired', finish);
    }
    cdp.on(tabId, 'Page.domContentEventFired', finish); // DOMContentLoaded
    cdp.on(tabId, 'Page.loadEventFired', finish);       // full load (whichever first)
  });
}

export async function navigate(tabId, url, extraWait = 800) {
  const dismiss = () => cdp.send(tabId, 'Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  let attached = false;
  try {
    await with_timeout(cdp.attach(tabId), 8_000, 'cdp_attach_timeout');
    attached = true;
    await with_timeout(cdp.send(tabId, 'Page.enable').catch(() => {}), 5_000, 'cdp_page_enable_timeout');
    cdp.on(tabId, 'Page.javascriptDialogOpening', dismiss);

    const p = wait_dom_ready(tabId); // listeners armed before navigation starts
    await with_timeout(chrome.tabs.update(tabId, { url }), 5_000, 'tab_update_timeout');
    await p;
    if (extraWait > 0) await new Promise(r => setTimeout(r, extraWait));
  } finally {
    cdp.off(tabId, 'Page.javascriptDialogOpening', dismiss);
    if (attached) await with_timeout(cdp.detach(tabId), 3_000, 'cdp_detach_timeout').catch(() => {});
  }
}
