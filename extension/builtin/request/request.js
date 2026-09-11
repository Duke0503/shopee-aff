export const tabless = false;
import { exec } from '../../background/exec.js';

export async function request(tab, { url, method = 'GET', headers = {}, body }) {
  return exec(tab.id, async (u, m, h, b) => {
    const r = await fetch(u, { method: m, headers: h, body: b ?? undefined, credentials: 'include' });
    const text = await r.text();
    return { status: r.status, text };
  }, url, method, headers, body ?? null);
}
