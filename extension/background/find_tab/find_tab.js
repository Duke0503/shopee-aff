import { wait_load }   from '../wait_load.js';
import { tab_storage } from './tab_storage.js';

const _initialized = new Set();
const _pending     = new Map(); // scoped tab id -> Promise<tab> -- prevents concurrent tab creation races

async function init_tab(tabId) {
  if (_initialized.has(tabId)) return;
  _initialized.add(tabId);
  chrome.tabs.update(tabId, { pinned: true }).catch(() => {});
}

async function recover_tab(hosts, owned, id) {
  const windows = await chrome.windows.getAll({ populate: true });
  const allTabs = windows.flatMap(w => w.tabs ?? []);

  const any = allTabs.find(t => hosts.some(h => t.url?.includes(h)));
  if (any) {
    await tab_storage.set({ ...owned, [id]: any.id });
    return chrome.tabs.get(any.id);
  }

  return null;
}

async function _find_tab(id, hosts, url, { recover_existing = true } = {}) {
  const owned = await tab_storage.get();

  if (owned[id] != null) {
    try {
      const tab = await chrome.tabs.get(owned[id]);
      if (tab.url && !hosts.some(h => tab.url.includes(h))) {
        throw new Error('Tab host mismatch');
      }
      await init_tab(tab.id);
      return tab;
    } catch {
      const { [id]: _removed, ...rest } = owned;
      await tab_storage.set(rest);
      if (recover_existing) {
        const recovered = await recover_tab(hosts, rest, id);
        if (recovered) {
          await init_tab(recovered.id);
          return recovered;
        }
      }
    }
  }

  const wins    = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (!wins.length) throw new Error('No current window');
  const target  = url ?? `https://${hosts[0]}`;
  const created = await chrome.tabs.create({ url: target, active: false, windowId: wins[0].id });
  await wait_load(created.id);
  await init_tab(created.id);

  await tab_storage.set({ ...await tab_storage.get(), [id]: created.id });
  return chrome.tabs.get(created.id);
}

export function find_tab(id, hosts, url, options = {}) {
  if (_pending.has(id)) return _pending.get(id);
  const p = _find_tab(id, hosts, url, options).finally(() => _pending.delete(id));
  _pending.set(id, p);
  return p;
}
