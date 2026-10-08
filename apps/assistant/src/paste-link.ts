import type { ApiConvertResult } from "@mmo/contracts";

import { extractFirstUrl } from "./parse-message";

/**
 * A customer pasted something in Zalo: hand the link to the server and decide
 * what to reply. The server is the only place that knows the shops, so this
 * never guesses a platform itself.
 */
export interface PasteLinkDeps {
  convert: (url: string, customerId?: string) => Promise<ApiConvertResult>;
}

export type PasteLinkOutcome =
  | { kind: "no_link" }
  | { kind: "unsupported" }
  | { kind: "ready"; affiliateUrl: string; requestId: string }
  | { kind: "pending"; requestId: string };

export async function handlePasteLink(
  text: string,
  customerId: string,
  deps: PasteLinkDeps,
): Promise<PasteLinkOutcome> {
  const url = extractFirstUrl(text);
  if (!url) return { kind: "no_link" };

  let result: ApiConvertResult;
  try {
    result = await deps.convert(url, customerId);
  } catch {
    return { kind: "unsupported" };
  }
  if (result.ready && result.affiliate_url) {
    return { kind: "ready", affiliateUrl: result.affiliate_url, requestId: result.request_id };
  }
  return { kind: "pending", requestId: result.request_id };
}
