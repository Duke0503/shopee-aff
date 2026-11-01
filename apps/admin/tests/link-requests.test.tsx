/**
 * Story 5.10 on the desk: the link requests list on GET /api/admin/link-requests. The Overview's
 * "failed links" tile opens it filtered to FAILED for today, the "requested" header sorts by the
 * request time it shows, phone rows are cards, and a guest request's owner is the guest account.
 * Server side: apps/server/tests/link-requests-desk.test.ts.
 */
import { overviewSchema, type DeskLinkRequestRow, type Overview } from "@cashback/contracts";
import { statusLabel } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminText } from "../src/labels";
import { LINK_REQUESTS_KEY } from "../src/links/link-requests.queries";
import { OVERVIEW_KEY } from "../src/overview/overview.queries";
import { EMPLOYEE, fakeServer, json, renderDesk, settle, type Route } from "./app-harness";
import fixture from "./fixtures/overview.json";
import { setViewportWidth } from "./viewport";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-30T05:00:00.000Z");
});
afterEach(() => {
  vi.useRealTimers();
});

function linkRow(n: number, over: Partial<DeskLinkRequestRow> = {}): DeskLinkRequestRow {
  return {
    requestId: `2610300000${n}`,
    customerCode: `DP0000${n}`,
    guest: false,
    productName: `Product ${n}`,
    productImageUrl: null,
    network: "shopee",
    platform: "shopee",
    channel: "zalo",
    status: "FAILED",
    attempts: 3,
    deliveredAt: null,
    createdAt: "2026-10-30T02:00:00.000Z",
    ...over,
  };
}

const ROWS = [linkRow(1), linkRow(2, { channel: "web" }), linkRow(3, { customerCode: null, guest: true, status: "DELIVERED", attempts: 1, deliveredAt: "2026-10-30T02:01:00.000Z" })];

function linksServer(rows = ROWS) {
  const queries: Record<string, string>[] = [];
  const route: Route = (url) => {
    if (url.pathname !== "/api/admin/link-requests") return undefined;
    queries.push(Object.fromEntries(url.searchParams));
    const failed = rows.filter((r) => r.status === "FAILED").length;
    return json(200, { rows, total: rows.length, page: 1, pageSize: 25, facets: { status: [{ value: "FAILED", count: failed }, { value: "DELIVERED", count: rows.length - failed }] }, summary: {}, asOf: "2026-10-30T05:00:00.000Z", overall: 120 });
  };
  return { route, queries };
}

async function links(path = "/admin/links", rows = ROWS) {
  const server = linksServer(rows);
  fakeServer({ session: EMPLOYEE, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, LINK_REQUESTS_KEY);
  return { ...view, server };
}

describe("Story 5.10 acceptance criteria on the desk", () => {
  it("AC1: the Overview's failed-links tile opens this list filtered to FAILED for today, which asks the server for exactly that set", async () => {
    const golden: Overview = overviewSchema.parse(fixture.overview);
    const overviewRoute: Route = (url) => (url.pathname === "/api/admin/overview" ? json(200, { ...golden, todo: { ...golden.todo, failedLinksToday: 2 } }) : undefined);
    const server = linksServer(ROWS.slice(0, 2));
    fakeServer({ session: EMPLOYEE, routes: [overviewRoute, server.route] });
    const view = renderDesk("/admin/");
    await settle(view.queryClient, OVERVIEW_KEY);
    const tile = document.querySelector('[data-todo="failed-links"]') as HTMLAnchorElement;
    expect(tile).toHaveTextContent(adminText("ov_todo_failed_value", { count: "2" }));
    const user = userEvent.setup();
    await user.click(tile);
    await settle(view.queryClient, LINK_REQUESTS_KEY);
    expect(server.queries.at(-1)).toMatchObject({ "filter[status]": "FAILED", "filter[createdAt]": expect.stringMatching(/^2026-10-30/) });
    expect(screen.getAllByText(adminText("links_count", { count: "2" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(2);
  });

  it("AC2: the requested header sorts by the request time it shows", async () => {
    const user = userEvent.setup();
    const { server } = await links();
    expect(server.queries.at(-1)?.["sort"]).toBeUndefined();
    await user.click(screen.getByRole("button", { name: new RegExp(adminText("col_requested_at")) }));
    await waitFor(() => expect(server.queries.at(-1)?.["sort"]).toBe("createdAt:asc"));
  });

  it("AC3: on a phone the rows are cards with the state badge, the customer code chip and one labelled time", async () => {
    setViewportWidth(390);
    await links();
    const card = screen.getByText("Product 1").closest("li") as HTMLElement;
    expect(within(card).getByText(statusLabel("status_link_request_failed"))).toBeInTheDocument();
    expect(within(card).getByText("DP00001")).toBeInTheDocument();
    expect(card).toHaveTextContent(adminText("col_requested_short"));
    expect(card.textContent).not.toContain(adminText("col_delivered_at"));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("AC4: a guest request's owner shows as the guest account, not as a customer, in the table and on a card", async () => {
    const first = await links();
    const guestRow = screen.getByText("Product 3").closest("tr") as HTMLElement;
    expect(within(guestRow).getByText(adminText("owner_guest"))).toBeInTheDocument();
    expect(within(guestRow).queryByText(/^DP/)).toBeNull();
    first.unmount();
    setViewportWidth(390);
    await links();
    const card = screen.getByText("Product 3").closest("li") as HTMLElement;
    expect(within(card).getByText(adminText("owner_guest"))).toBeInTheDocument();
    expect(within(card).queryByText(/^DP/)).toBeNull();
  });
});
