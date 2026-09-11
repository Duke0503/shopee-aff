import { base_url as BASE, bridge_token } from './base_url.js';
import { uid }              from './uid.js';

const HEARTBEAT_INTERVAL = 30_000;
const REGISTER_RETRY_MS  = 5_000;

async function register() {
  const win = await chrome.windows.getCurrent().catch(() => null);
  try {
    await fetch(`${BASE}/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': bridge_token },
      body:    JSON.stringify({ uuid: uid.value, windowId: win?.id ?? null }),
    });
  } catch {
    setTimeout(register, REGISTER_RETRY_MS);
  }
}

async function send_heartbeat() {
  const win = await chrome.windows.getCurrent().catch(() => null);
  try {
    await fetch(`${BASE}/heartbeat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': bridge_token },
      body:    JSON.stringify({ uuid: uid.value, windowId: win?.id ?? null }),
    });
  } catch {}
}

export async function init() {
  const stored = await chrome.storage.local.get('instance_uuid');
  let id = stored.instance_uuid;
  if (!id) {
    id = crypto.randomUUID();
    await chrome.storage.local.set({ instance_uuid: id });
  }
  uid.set(id);
  await register();
  setInterval(send_heartbeat, HEARTBEAT_INTERVAL);
  send_heartbeat();
}
