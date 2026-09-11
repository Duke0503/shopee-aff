// Fetch from the service worker rather than from a page.
//
// A fetch made inside a tab is bound by that page's origin, so calling
// shopee.vn from the affiliate.shopee.vn tab dies on CORS. A fetch issued
// by the extension itself is not: with the host listed in
// host_permissions, Chrome allows it and still sends the user's cookies.
//
// This is how a product's name can be read from an item id, which is the
// only handle a short link leaves behind.
export const tabless = true;

export async function fetch_bg({ url, method = 'GET', headers = {}, body, timeout_ms = 20000 }) {
  if (!url) throw new Error('fetch_bg needs a url');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      credentials: 'include',
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, url: response.url, text };
  } catch (error) {
    return { status: 0, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}
