const KEY = 'cashback:tabs';

export const tab_storage = {
  get: async () => { const r = await chrome.storage.local.get([KEY]); return r[KEY] ?? {}; },
  set: async owned => chrome.storage.local.set({ [KEY]: owned }),
};
