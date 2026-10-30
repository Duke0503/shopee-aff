/**
 * Story 4.21 on the admin desk: the network payouts tab lists the batches with the server's
 * figures, and opening one shows its gross, fee, tax, received, the gross of the customers' orders
 * and the unattributed rest, and its orders with product thumbnails (AC4); the payout panel says for each covered order
 * whether the network paid it and by which payout (AC5).
 */
import type { NetworkSettlementDetail, NetworkSettlementRow } from "@cashback/contracts";
import { formatMoney } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { adminText } from "../src/labels";
import { NETWORK_SETTLEMENTS_KEY } from "../src/payouts/network-settlements.queries";
import { PAYOUTS_KEY } from "../src/payouts/payouts.queries";
import { EMPLOYEE, fakeServer, json, renderDesk, settle, type Route } from "./app-harness";
import { PAYOUT_FIXTURES, payoutRow, payoutServer, payoutsAnswer } from "./payout-fixtures";
import { setViewportWidth } from "./viewport";

const ROW: NetworkSettlementRow = { settlementId: 7, network: "shopee", networkPayoutId: "1034567", status: "PAID", match: "MATCHED", amount: 386938, eligibleAmount: 434665, withheld: true, fee: 4260, tax: 43467, matchedGross: 411665, unattributed: 23000, orderCount: 2, paidAt: "2026-10-10T03:00:00.000Z", createdAt: "2026-10-05T03:00:00.000Z" };

const DETAIL: NetworkSettlementDetail = {
  ...ROW,
  listed: false,
  windowFrom: "2026-10-01T03:00:00.000Z",
  openCaseIds: [],
  orders: [
    { orderId: "251019ZT45LB", outcome: "SETTLED", gross: 371665, net: 330856, customerCode: "DP00012", customerName: PAYOUT_FIXTURES.names[0] ?? null, productName: "Noi com", productImageUrl: "https://cf.example.test/a.jpg", status: "APPROVED", settledBy: "1034567" },
    { orderId: "251020M8RR0Q", outcome: "SETTLED", gross: 40000, net: 35608, customerCode: "DP00031", customerName: PAYOUT_FIXTURES.names[1] ?? null, productName: null, productImageUrl: null, status: "PAID", settledBy: "1034567" },
  ],
};

function networkServer() {
  const paths: string[] = [];
  const route: Route = (url) => {
    if (!url.pathname.startsWith("/api/admin/network-settlements")) return undefined;
    paths.push(url.pathname);
    if (url.pathname === "/api/admin/network-settlements") return json(200, { rows: [ROW], total: 1, page: 1, pageSize: 25, facets: {}, summary: { amount: 386938, eligibleAmount: 434665, matchedGross: 411665 }, asOf: "2026-10-30T12:42:00.000Z" });
    return json(200, DETAIL);
  };
  return { route, paths };
}

describe("Story 4.21 on the desk", () => {
  it("AC4: the tab lists each network payout with the server's amount, matched total and difference, and its orders open with thumbnails and the same figures", async () => {
    const user = userEvent.setup();
    const server = networkServer();
    fakeServer({ session: EMPLOYEE, routes: [server.route] });
    const view = renderDesk("/admin/payouts/network");
    await settle(view.queryClient, NETWORK_SETTLEMENTS_KEY);
    expect(screen.getByRole("tab", { name: adminText("payouts_tab_network") })).toHaveAttribute("aria-selected", "true");
    const row = screen.getByText("1034567").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent(formatMoney(434665) ?? "");
    expect(row).toHaveTextContent(formatMoney(386938) ?? "");
    expect(row).toHaveTextContent(formatMoney(411665) ?? "");
    expect(within(row).getByText(formatMoney(23000) ?? "")).toHaveAttribute("data-unattributed", "rest");
    expect(within(row).getByText(adminText("match_matched"))).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: adminText("network_open_aria", { id: "1034567" }) }));
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText("Noi com");
    expect(server.paths.at(-1)).toBe("/api/admin/network-settlements/7");
    const fact = (key: Parameters<typeof adminText>[0]) => within(sheet).getByText(adminText(key)).closest("div") as HTMLElement;
    expect(fact("network_detail_eligible")).toHaveTextContent(formatMoney(434665) ?? "");
    expect(fact("network_detail_fee")).toHaveTextContent(formatMoney(4260) ?? "");
    expect(fact("network_detail_tax")).toHaveTextContent(formatMoney(43467) ?? "");
    expect(fact("network_detail_received")).toHaveTextContent(formatMoney(386938) ?? "");
    expect(fact("network_detail_matched_gross")).toHaveTextContent(formatMoney(411665) ?? "");
    expect(fact("network_detail_unattributed")).toHaveTextContent(formatMoney(23000) ?? "");
    expect(within(sheet).getByText(adminText("withheld_yes"))).toBeInTheDocument();
    expect(within(sheet).getByText(adminText("network_detail_by_window"))).toBeInTheDocument();
    const lines = sheet.querySelectorAll("[data-settlement-order]");
    expect(lines).toHaveLength(2);
    expect((lines[0] as HTMLElement).querySelector("img")).toHaveAttribute("src", "https://cf.example.test/a.jpg");
    expect((lines[1] as HTMLElement).querySelector("[data-thumb=placeholder]")).not.toBeNull();
    expect(lines[0]).toHaveTextContent(formatMoney(330856) ?? "");
    expect(lines[0]).toHaveTextContent(adminText("network_detail_gross", { amount: formatMoney(371665) ?? "" }));
    expect(lines[0]).toHaveTextContent(adminText("outcome_settled"));
  });

  it("a mismatch says by how much the orders exceed the batch and that nothing was settled", async () => {
    const user = userEvent.setup();
    const mismatch = { ...DETAIL, match: "MISMATCH" as const, matchedGross: 440665, unattributed: -6000, openCaseIds: [12] };
    const list = json(200, { rows: [{ ...ROW, match: "MISMATCH", unattributed: -6000 }], total: 1, page: 1, pageSize: 25, facets: {}, summary: {}, asOf: "2026-10-30T12:42:00.000Z" });
    fakeServer({ session: EMPLOYEE, routes: [(url) => (url.pathname === "/api/admin/network-settlements" ? list : url.pathname.startsWith("/api/admin/network-settlements/") ? json(200, mismatch) : undefined)] });
    const view = renderDesk("/admin/payouts/network");
    await settle(view.queryClient, NETWORK_SETTLEMENTS_KEY);
    expect(screen.getByText(formatMoney(-6000) ?? "")).toHaveAttribute("data-unattributed", "over");
    await user.click(screen.getByRole("button", { name: adminText("network_open_aria", { id: "1034567" }) }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText(adminText("network_detail_mismatch", { over: formatMoney(6000) ?? "" }))).toBeInTheDocument();
    expect(within(sheet).getByText(adminText("network_detail_cases", { count: 1 }))).toBeInTheDocument();
  });

  it("on a phone the payouts are cards and the orders open full height", async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    fakeServer({ session: EMPLOYEE, routes: [networkServer().route] });
    const view = renderDesk("/admin/payouts/network");
    await settle(view.queryClient, NETWORK_SETTLEMENTS_KEY);
    const card = document.querySelector("[data-card=network-settlement]") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: adminText("network_open_aria", { id: "1034567" }) }));
    const sheet = await screen.findByRole("dialog");
    await waitFor(() => expect(sheet.querySelector("[data-panel=drawer]")).not.toBeNull());
  });

  it("AC5: the payout panel says for each covered order whether the network paid it and by which payout", async () => {
    const user = userEvent.setup();
    const payouts = payoutServer(() => payoutsAnswer([payoutRow(0, { payable: 135216 })], 135216));
    fakeServer({ session: EMPLOYEE, routes: [payouts.route] });
    const view = renderDesk("/admin/payouts");
    await settle(view.queryClient, PAYOUTS_KEY);
    await user.click(screen.getByRole("button", { name: adminText("payout_open_aria", { name: PAYOUT_FIXTURES.names[0] ?? "" }) }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(adminText("panel_settled_by", { payout: "1034567" }))).toBeInTheDocument();
    expect(within(dialog).getByText(adminText("panel_unsettled"))).toBeInTheDocument();
  });
});
