import { statusLabel, uiText } from "@cashback/ui";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { adminText } from "../src/labels";
import { parseSearch, stringifySearch } from "../src/search-params";
import { ORDERS_KEY } from "../src/orders/orders.queries";
import { EMPLOYEE, envelope, fakeServer, orderRow, ordersAnswer, renderDesk, settle, type Route } from "./app-harness";

const SHARED = "/admin/orders?q=nguyen&filter[status]=APPROVED,PAID&sort=cashback:asc&page=2";

const ordersRoute =
  (answer: (url: URL) => ReturnType<typeof ordersAnswer>): Route =>
  (url) =>
    url.pathname === "/api/admin/orders" ? answer(url) : undefined;

const listRequests = (requests: { url: URL }[]) => requests.filter((r) => r.url.pathname === "/api/admin/orders").map((r) => Object.fromEntries(r.url.searchParams));

const chip = (labelKey: string) => screen.getByRole("button", { name: new RegExp(`^${statusLabel(labelKey)} \\d`) });

describe("Story 4.5 AC1: refresh or a shared link restores the same rows, chips and sort; defaults stay out of the URL", () => {
  it("restores search, two chips, sort and page from a shared URL and sends exactly that query", async () => {
    const rows = [orderRow(1, { status: "PAID" }), orderRow(2)];
    const server = fakeServer({ session: EMPLOYEE, routes: [ordersRoute(() => ordersAnswer(rows, { total: 30, page: 2 }))] });
    const { queryClient } = renderDesk(SHARED);
    await settle(queryClient, ORDERS_KEY);
    expect(screen.getByText(rows[0]?.customerName ?? "")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("nguyen");
    expect(chip("status_approved")).toHaveAttribute("aria-pressed", "true");
    expect(chip("status_paid")).toHaveAttribute("aria-pressed", "true");
    expect(chip("status_awaiting_approval")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("columnheader", { name: new RegExp(adminText("col_cashback")) })).toHaveAttribute("aria-sort", "ascending");
    expect(listRequests(server.requests)[0]).toEqual({ q: "nguyen", "filter[status]": "APPROVED,PAID", sort: "cashback:asc", page: "2", pageSize: "25" });
  });

  it("shows the same view again after a reload of the same address", async () => {
    const server = fakeServer({ session: EMPLOYEE, routes: [ordersRoute(() => ordersAnswer([orderRow(1)], { total: 30, page: 2 }))] });
    const first = renderDesk(SHARED);
    await screen.findByRole("searchbox");
    await waitFor(() => expect(listRequests(server.requests)).toHaveLength(1));
    const address = `${first.history.location.pathname}${first.history.location.search}`;
    first.unmount();
    renderDesk(address);
    await waitFor(() => expect(listRequests(server.requests)).toHaveLength(2));
    expect(listRequests(server.requests)[1]).toEqual(listRequests(server.requests)[0]);
    expect(address).toBe(SHARED);
  });

  it("writes a chip toggle to the URL, back to page 1, and leaves every default out", async () => {
    const server = fakeServer({ session: EMPLOYEE, routes: [ordersRoute(() => ordersAnswer([orderRow(1)]))] });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/orders?page=3&sort=recordedAt:desc&pageSize=25");
    await screen.findByRole("searchbox");
    await waitFor(() => expect(history.location.search).toBe(""));
    await user.click(chip("status_approved"));
    await waitFor(() => expect(history.location.search).toBe("?filter[status]=APPROVED"));
    expect(listRequests(server.requests).at(-1)).toEqual({ "filter[status]": "APPROVED", pageSize: "25" });
    await user.click(screen.getByRole("button", { name: new RegExp(`^${uiText("list_all")}`) }));
    await waitFor(() => expect(history.location.search).toBe(""));
  });

  it("keeps the typed search in the URL after the debounce, trimmed", async () => {
    fakeServer({ session: EMPLOYEE, routes: [ordersRoute(() => ordersAnswer([orderRow(1)]))] });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/orders");
    await user.type(await screen.findByRole("searchbox"), "  DP00012 {Enter}");
    await waitFor(() => expect(history.location.search).toBe("?q=DP00012"));
  });

  it("shows the list error, not an empty list, while the orders endpoint answers an error", async () => {
    fakeServer({ session: EMPLOYEE, routes: [(url) => (url.pathname === "/api/admin/orders" ? envelope(404, "not_found", "error.not_found") : undefined)] });
    renderDesk("/admin/orders");
    expect(await screen.findByRole("alert")).toHaveTextContent(uiText("list_error_title"));
    expect(screen.queryByText(adminText("orders_empty"))).toBeNull();
  });
});

describe("URL search serialisation keeps the list query readable and exact", () => {
  it("round-trips brackets, colons, commas and encoded text", () => {
    const search = { q: "L\u00ea & co", "filter[status]": "APPROVED,PAID", sort: "cashback:desc" };
    const text = stringifySearch(search);
    expect(text).toBe("?q=L%C3%AA%20%26%20co&filter[status]=APPROVED,PAID&sort=cashback:desc");
    expect(parseSearch(text)).toEqual(search);
    expect(stringifySearch({})).toBe("");
  });
});
