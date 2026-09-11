const refs = new Map(); // tabId -> refcount
const subs = new Map(); // `${tabId}\0${event}` -> Set<fn>
const attaches = new Map(); // tabId -> in-flight chrome.debugger.attach promise

chrome.debugger.onEvent.addListener((source, method, params) => {
  const key = `${source.tabId}\0${method}`;
  for (const fn of subs.get(key) ?? []) fn(params);
});

chrome.debugger.onDetach.addListener(({ tabId }) => {
  refs.delete(tabId);
  for (const key of subs.keys()) {
    if (key.startsWith(`${tabId}\0`)) subs.delete(key);
  }
});

export const cdp = {
  async attach(tabId) {
    const n = refs.get(tabId) ?? 0;
    if (n > 0) {
      refs.set(tabId, n + 1);
      return;
    }

    let pending = attaches.get(tabId);
    if (!pending) {
      // A stale/orphaned attachment leaves Chrome holding the debugger while this MV3 service
      // worker's in-memory refs are empty -- e.g. the SW was recycled between operations, or a
      // controlling process was killed mid-op (a hard Ctrl-C during execute_script). Chrome then
      // rejects every future attach with "Another debugger is already attached to the tab",
      // wedging the tab forever. Recover by detaching the orphan and re-attaching once.
      pending = chrome.debugger.attach({ tabId }, '1.3').catch(async err => {
        if (!/already attached/i.test(String(err?.message ?? err))) throw err;
        await chrome.debugger.detach({ tabId }).catch(() => {});
        return chrome.debugger.attach({ tabId }, '1.3');
      });
      attaches.set(tabId, pending);
    }
    try {
      await pending;
      refs.set(tabId, (refs.get(tabId) ?? 0) + 1);
    } finally {
      if (attaches.get(tabId) === pending) attaches.delete(tabId);
    }
  },

  async detach(tabId) {
    const n = (refs.get(tabId) ?? 1) - 1;
    if (n <= 0) {
      refs.delete(tabId);
      await chrome.debugger.detach({ tabId }).catch(() => {});
    } else {
      refs.set(tabId, n);
    }
  },

  send(tabId, method, params = {}) {
    return chrome.debugger.sendCommand({ tabId }, method, params);
  },

  on(tabId, event, fn) {
    const key = `${tabId}\0${event}`;
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(fn);
  },

  off(tabId, event, fn) {
    subs.get(`${tabId}\0${event}`)?.delete(fn);
  },
};
