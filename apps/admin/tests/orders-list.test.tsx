/**
 * Story 4.13 on the admin desk: the Orders list on GET /api/admin/orders. Screen-side regressions
 * of list-defects "Orders": "Today" sends the Vietnam day, sorts send the displayed field, the
 * "all" chip carries the overall total named as such, one network filter, the year on dates of
 * another year, and no action on any row (the only way to PAID is a payout confirm).
 */
import { statusLabel, uiText } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminText } from "../src/labels";
import { ORDERS_KEY } from "../src/orders/orders.queries";
import { EMPLOYEE, fakeServer, orderRow, ordersAnswer, renderDesk, settle, type Route } from "./app-harness";
import { setViewportWidth } from "./viewport";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 06:30 on 30 Oct in Vietnam, still 29 Oct in UTC.
  vi.setSystemTime("2026-10-29T23:30:00.000Z");
});
afterEach(() => {
  vi.useRealTimers();
});

function ordersServer(rows = [orderRow(1), orderRow(2, { status: "AWAITING_APPROVAL", approvedCommission: null, cashback: null, recordedAt: "2025-12-31T03:00:00.000Z" })]) {
  const queries: Record<string, string>[] = [];
  const route: Route = (url) => {
    if (url.pathname !== "/api/admin/orders") return undefined;
    queries.push(Object.fromEntries(url.searchParams));
    return ordersAnswer(rows, { total: 79, overall: 4912 });
  };
  return { route, queries };
}

async function orders(path = "/admin/orders") {
  const server = ordersServer();
  fakeServer({ session: EMPLOYEE, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, ORDERS_KEY);
  return { ...view, server };
}

describe("Story 4.13 acceptance criteria on the desk", () => {
  it("AC1: 'Today' at 06:30 Vietnam time sends the Vietnam day, and a date kind switch keeps it on the new kind's column", async () => {
    const user = userEvent.setup();
    const { server, history } = await orders();
    await user.selectOptions(screen.getByRole("combobox", { name: uiText("list_date_days") }), uiText("list_date_today"));
    await waitFor(() => expect(server.queries.at(-1)?.["filter[recordedAt]"]).toBe("2026-10-30"));
    await user.selectOptions(screen.getByRole("combobox", { name: uiText("list_date_kind") }), adminText("col_approved_at"));
    await waitFor(() => expect(history.location.search).toBe("?filter[approvedAt]=2026-10-30"));
    expect(await screen.findByRole("columnheader", { name: new RegExp(adminText("col_approved_at")) })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: new RegExp(adminText("col_recorded_at")) })).toBeNull();
  });

  it("AC2: the commission header sorts by the approved commission it shows, and the cashback header by the cashback", async () => {
    const user = userEvent.setup();
    const { server } = await orders();
    await user.click(screen.getByRole("button", { name: new RegExp(adminText("col_approved_commission")) }));
    await waitFor(() => expect(server.queries.at(-1)?.["sort"]).toBe("approvedCommission:desc"));
    await user.click(screen.getByRole("button", { name: new RegExp(`^${adminText("col_cashback")}`) }));
    await waitFor(() => expect(server.queries.at(-1)?.["sort"]).toBe("cashback:desc"));
  });

  it("AC3: the search names only what is searched and sends the text as typed for the server to fold", async () => {
    const user = userEvent.setup();
    const { server } = await orders();
    const box = screen.getByRole("searchbox");
    expect(box).toHaveAttribute("placeholder", adminText("orders_search"));
    await user.type(box, "nguyen 10%{Enter}");
    await waitFor(() => expect(server.queries.at(-1)?.["q"]).toBe("nguyen 10%"));
  });

  it("AC4: the 'all' chip shows the overall total named as such, the summary says it apart, each chip counts the filtered set, and there is one network filter", async () => {
    await orders();
    expect(screen.getByRole("button", { name: uiText("list_all_overall", { total: "4.912" }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${statusLabel("status_approved")} 1` })).toBeInTheDocument();
    const summary = screen.getAllByText(adminText("orders_count", { count: "79" })).map((n) => n.closest("p")).find((p) => p !== null) as HTMLElement;
    expect(summary).toHaveTextContent(uiText("list_total_overall", { total: adminText("orders_count", { count: "4.912" }) }));
    expect(screen.getAllByRole("combobox", { name: adminText("orders_network") })).toHaveLength(1);
    expect(screen.getAllByRole("option", { name: adminText("orders_network_all") })).toHaveLength(1);
  });

  it("AC5: a date in another year shows the year, one in this year does not; status sorts on the server's lifecycle order", async () => {
    const user = userEvent.setup();
    const { server } = await orders();
    expect(screen.getByText("31/12/2025")).toBeInTheDocument();
    expect(screen.getByText("30/10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(`^${adminText("col_status")}`) }));
    await waitFor(() => expect(server.queries.at(-1)?.["sort"]).toBe("status:asc"));
  });

  it("AC6: no row has a 'refund' or 'mark paid' action, on desktop or phone: the only buttons are the code chips' copy", async () => {
    const copyOnly = (scope: HTMLElement) => within(scope).queryAllByRole("button").filter((b) => !(b.getAttribute("aria-label") ?? "").startsWith(uiText("code_copy", { code: "" })));
    const first = await orders();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(copyOnly(row)).toEqual([]);
    first.unmount();
    setViewportWidth(390);
    await orders();
    const list = screen.getByText(orderRow(1).productName ?? "").closest("ul") as HTMLElement;
    expect(copyOnly(list)).toEqual([]);
    // The card's meta line names the network in words, not its stored key.
    expect(list).toHaveTextContent(adminText("network_shopee"));
    expect(list.textContent).not.toContain(" shopee ");
  });
});
