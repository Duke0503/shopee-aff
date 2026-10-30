import type { ZaloClient } from "./zalo-client";

export interface ZcaOptions {
  cookie: string;
  serverUrl: string;
  token: string;
}

/**
 * The real transport (`zca-js`) plugs in HERE and nowhere else.
 *
 * It is deliberately not implemented: attaching a live personal Zalo account
 * is the Phase-7 account-lock risk, and it is the owner's call when to take
 * it. Until then every test and dry run uses `FakeZaloClient`, so no code
 * path can reach a real account by accident.
 */
export function createZcaClient(_options: ZcaOptions): ZaloClient {
  throw new Error("createZcaClient: the zca-js adapter is not wired yet");
}
