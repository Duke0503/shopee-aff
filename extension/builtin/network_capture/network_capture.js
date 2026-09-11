export const tabless = false;
import { cdp } from '../../background/cdp.js';

const sessions = new Map(); // tabId -> { requests, pending, onRequest, onResponse, include_post_data, max_post_data_chars, url_pattern }

function matches_url(url, pattern) {
  if (!pattern) return true;
  return String(url).includes(String(pattern));
}

function trim_post_data(value, max_chars) {
  if (typeof value !== 'string') return undefined;
  const limit = Math.max(0, Number(max_chars ?? 0));
  if (!limit || value.length <= limit) return value;
  return `${value.slice(0, limit)}...<truncated:${value.length - limit}>`;
}

export async function network_capture(tab, { action, include_post_data = false, include_headers = false, max_post_data_chars = 2000, url_pattern = '' }) {
  const { id: tabId } = tab;

  if (action === 'start') {
    if (sessions.has(tabId)) return { ok: true, status: 'already_started' };

    const pending  = new Map();
    const requests = [];

    const onRequest = ({ requestId, request, type }) => {
      if (!matches_url(request.url, url_pattern)) return;
      const entry = {
        url: request.url,
        method: request.method,
        type,
        headers: include_headers ? request.headers : undefined,
        post_data: include_post_data ? trim_post_data(request.postData, max_post_data_chars) : undefined,
      };
      pending.set(requestId, entry);
      // Large bodies are not inlined in requestWillBeSent -- fetch them explicitly.
      if (include_post_data && entry.post_data === undefined && request.hasPostData) {
        entry.__await_post_data = true;
        cdp.send(tabId, 'Network.getRequestPostData', { requestId })
          .then(({ postData }) => { entry.post_data = trim_post_data(postData, max_post_data_chars); })
          .catch(() => {})
          .finally(() => { delete entry.__await_post_data; });
      }
    };

    const onResponse = ({ requestId, type, response }) => {
      const req = pending.get(requestId);
      if (!req) return;
      // Mutate + keep the same reference so a late getRequestPostData resolution still lands.
      req.type   = type ?? req.type;
      req.status = response.status;
      req.mime   = response.mimeType;
      if (req.headers === undefined) delete req.headers;
      if (req.post_data === undefined && !req.__await_post_data) delete req.post_data;
      requests.push(req);
      pending.delete(requestId);
    };

    sessions.set(tabId, { requests, pending, onRequest, onResponse, include_post_data, include_headers, max_post_data_chars, url_pattern });
    await cdp.attach(tabId);
    await cdp.send(tabId, 'Network.enable', {});
    cdp.on(tabId, 'Network.requestWillBeSent', onRequest);
    cdp.on(tabId, 'Network.responseReceived',  onResponse);
    return { ok: true, status: 'started' };
  }

  if (action === 'get' || action === 'stop') {
    const session  = sessions.get(tabId);
    const requests = (session?.requests ?? []).map(({ __await_post_data, ...rest }) => rest);

    if (action === 'stop' && session) {
      cdp.off(tabId, 'Network.requestWillBeSent', session.onRequest);
      cdp.off(tabId, 'Network.responseReceived',  session.onResponse);
      await cdp.send(tabId, 'Network.disable', {});
      await cdp.detach(tabId);
      sessions.delete(tabId);
    }

    return { ok: true, requests };
  }

  throw new Error(`network_capture: unknown action "${action}"`);
}
