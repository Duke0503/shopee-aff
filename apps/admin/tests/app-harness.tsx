/**
 * The whole admin desk in jsdom: the real router on a memory history at a given /admin URL, a
 * fresh QueryClient, and a fake server answering /api/admin by path. Requests are recorded so a
 * test can check the exact list query the URL produced.
 */
import type { ListResponse, StaffSessionResponse } from "@cashback/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";

import { App } from "../src/app";
import fixtures from "./fixtures/orders.json";
import type { OrderRow } from "../src/orders/orders.queries";
import { createAppRouter } from "../src/router";

export const EMPLOYEE: StaffSessionResponse = { staffId: "stf_2", username: "tu", role: "EMPLOYEE" };
export const ADMIN: StaffSessionResponse = { staffId: "stf_1", username: "minh", role: "ADMIN" };

export type Answer = { status: number; body: unknown };
export type Route = (url: URL, init: RequestInit | undefined) => Answer | Promise<Answer> | undefined;

export const json = (status: number, body: unknown): Answer => ({ status, body });
export const envelope = (status: number, code: string, messageKey: string, fields?: Record<string, string>): Answer => json(status, { error: { code, messageKey, ...(fields ? { fields } : {}) } });

export function orderRow(n: number, overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    orderId: `2610300000${String(n).padStart(4, "0")}`,
    customerCode: `DP${String(n).padStart(5, "0")}`,
    customerName: fixtures.customerNames[n % fixtures.customerNames.length] ?? null,
    productName: fixtures.products[n % fixtures.products.length] ?? null,
    productImageUrl: n % 2 === 0 ? `https://cf.example.test/file/p${n}.jpg` : null,
    network: "Shopee",
    status: "APPROVED",
    cashback: 9263,
    recordedAt: "2026-10-30T05:00:00.000Z",
    ...overrides,
  };
}

export function ordersAnswer(rows: readonly OrderRow[], extra: Partial<ListResponse<OrderRow>> = {}): Answer {
  const facets = { status: ["AWAITING_APPROVAL", "FROZEN", "APPROVED", "REVERSED", "PAID", "REJECTED"].map((value) => ({ value, count: rows.filter((r) => r.status === value).length })) };
  return json(200, { rows, total: rows.length, page: 1, pageSize: 25, facets, summary: { cashback: 0 }, asOf: "2026-10-30T12:42:00.000Z", ...extra });
}

export interface ServerOptions {
  readonly session?: StaffSessionResponse | null;
  readonly routes?: readonly Route[];
}

export function fakeServer({ session = EMPLOYEE, routes = [] }: ServerOptions = {}) {
  const requests: { method: string; url: URL; body: unknown }[] = [];
  let current = session;
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://admin.example.test");
    requests.push({ method: init?.method ?? "GET", url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    let answer: Answer | undefined;
    for (const route of routes) {
      answer = await route(url, init);
      if (answer !== undefined) break;
    }
    if (answer === undefined && url.pathname === "/api/admin/session") {
      if ((init?.method ?? "GET") === "DELETE") {
        current = null;
        answer = json(200, { signedOut: true });
      } else answer = current === null ? envelope(401, "unauthorized", "error.unauthorized") : json(200, current);
    }
    answer ??= envelope(404, "not_found", "error.not_found");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchStub);
  return { requests, setSession: (next: StaffSessionResponse | null) => (current = next) };
}

export function renderDesk(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(history);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<App router={router} queryClient={queryClient} />);
  return { ...view, router, history, queryClient };
}

/**
 * Resolves when the first query under `key` has settled (data or error), driven by the query
 * cache's own events, not by a clock: under load the desk's cold first render (session check,
 * route load, first list request) can take longer than any fixed wait. Render the result with
 * `settle()` below, which flushes React inside act.
 */
export function querySettled(client: QueryClient, key: readonly unknown[]): Promise<void> {
  const matches = (queryKey: readonly unknown[]): boolean => key.every((part, i) => queryKey[i] === part);
  const done = (): boolean => client.getQueryCache().findAll({ queryKey: key }).some((q) => matches(q.queryKey) && (q.state.status === "success" || q.state.status === "error") && q.state.fetchStatus === "idle");
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = client.getQueryCache().subscribe(() => {
      if (!done()) return;
      stop();
      resolve();
    });
  });
}

/** Waits for the query to settle and lets React and the query observers finish rendering it. */
export async function settle(client: QueryClient, key: readonly unknown[]): Promise<void> {
  await act(async () => {
    await querySettled(client, key);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
