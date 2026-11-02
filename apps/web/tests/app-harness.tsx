/**
 * The whole website in jsdom: the real router on a memory history at a given path, a fresh
 * QueryClient, and a fake server answering /api/session and /api/site-status (and any route a
 * test adds). Requests are recorded so a test can check what was sent.
 */
import type { CustomerSessionResponse, SiteStatusResponse } from "@cashback/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { App } from "../src/app";
import { createAppRouter } from "../src/router";

export const LAN: CustomerSessionResponse = { customerCode: "DP00012" };
export const UP: SiteStatusResponse = { assistant: "up", fallbackContactUrl: null, assistantUrl: null };
export const FALLBACK = "https://m.me/hoantiendp.test";
export const ASSISTANT_CHAT = "https://zalo.me/0900000000";
export const DOWN: SiteStatusResponse = { assistant: "down", fallbackContactUrl: FALLBACK, assistantUrl: ASSISTANT_CHAT };

export type Answer = { status: number; body: unknown };
export type Route = (url: URL, init: RequestInit | undefined) => Answer | undefined;

export const json = (status: number, body: unknown): Answer => ({ status, body });
export const envelope = (status: number, code: string, messageKey: string, fields?: Record<string, string>): Answer => json(status, { error: { code, messageKey, ...(fields ? { fields } : {}) } });

export interface ServerOptions {
  /** The signed-in customer, null for none, or an error answer (a session a new password ended). */
  readonly session?: CustomerSessionResponse | null | Answer;
  readonly status?: SiteStatusResponse;
  readonly routes?: readonly Route[];
}

const isAnswer = (value: unknown): value is Answer => typeof value === "object" && value !== null && "status" in value && "body" in value;

export function fakeServer({ session = null, status = UP, routes = [] }: ServerOptions = {}) {
  const requests: { method: string; url: URL; body: unknown }[] = [];
  let current = session;
  let siteStatus = status;
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://hoantiendp.test");
    const method = init?.method ?? "GET";
    requests.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
    let answer = routes.reduce<Answer | undefined>((found, route) => found ?? route(url, init), undefined);
    if (answer === undefined && url.pathname === "/api/site-status") answer = json(200, siteStatus);
    if (answer === undefined && url.pathname === "/api/session") {
      if (method === "DELETE") {
        current = null;
        answer = json(200, { signedOut: true });
      } else if (isAnswer(current)) answer = current;
      else answer = current === null ? envelope(401, "unauthorized", "error.unauthorized") : json(200, current);
    }
    answer ??= envelope(404, "not_found", "error.not_found");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchStub);
  return {
    requests,
    setSession: (next: CustomerSessionResponse | null | Answer) => (current = next),
    setStatus: (next: SiteStatusResponse) => (siteStatus = next),
  };
}

export function renderSite(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(history);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<App router={router} queryClient={queryClient} />);
  return { ...view, router, history, queryClient };
}

/** The Zalo in-app browser on an Android phone, as Zalo sends it. */
export const ZALO_ANDROID_UA = "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Zalo android/12100621 ZaloTheme/light ZaloLanguage/vi";

export function asZaloBrowser(): void {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: ZALO_ANDROID_UA });
}
