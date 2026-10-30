/**
 * Stories 4.12 and 4.10 on the admin desk: the history tab lists every payout, voided ones with
 * their badge, with a paid summary over the filtered set that says it leaves voided payouts out;
 * the date filter's "this month" is the Vietnam month with its whole last day; void is opened from
 * a history row by an admin only, on the server's preview, with a required reason, and every list
 * refreshes after it (LC-10).
 */
import type { PayoutHistoryRow, PayoutVoidPreview } from "@cashback/contracts";
import { formatMoney, statusLabel, uiText } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminText } from "../src/labels";
import { PAYOUT_HISTORY_KEY } from "../src/payouts/payout-history.queries";
import { ADMIN, EMPLOYEE, fakeServer, json, renderDesk, settle, type Answer, type Route } from "./app-harness";
import { PAYOUT_FIXTURES } from "./payout-fixtures";
import { setViewportWidth } from "./viewport";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-30T12:00:00.000Z");
});
afterEach(() => {
  vi.useRealTimers();
});

function historyRow(n: number, overrides: Partial<PayoutHistoryRow> = {}): PayoutHistoryRow {
  return {
    payoutId: 40 + n,
    customerId: `P${n}`,
    customerCode: `DP${String(12 + n).padStart(5, "0")}`,
    customerName: PAYOUT_FIXTURES.names[n % PAYOUT_FIXTURES.names.length] ?? null,
    amount: 135216,
    paidAmount: 135216,
    status: "RECORDED",
    recordedAt: "2026-10-30T05:45:00.000Z",
    recordedBy: "minh",
    voidedAt: null,
    receiptToken: `rcpt_token_${n}`,
    ...overrides,
  };
}

const ROWS = [historyRow(1), historyRow(2, { status: "VOIDED", paidAmount: 0, amount: 36000, voidedAt: "2026-10-30T07:00:00.000Z" })];

function voidPreview(overrides: Partial<PayoutVoidPreview> = {}): PayoutVoidPreview {
  return {
    payoutId: 41,
    customerId: "P1",
    customerCode: "DP00013",
    amount: 135216,
    status: "RECORDED",
    recordedAt: "2026-10-30T05:45:00.000Z",
    voidedAt: null,
    orders: [
      { orderId: "261001A0001", cashback: 79216, to: "REVERSED" },
      { orderId: "261001A0002", cashback: 36000, to: "APPROVED" },
    ],
    awards: [{ awardId: 1, orderId: "261001A0001", amount: 20000, to: "VOID" }],
    nettingReversed: 0,
    clawbacksClosed: 99216,
    refunded: 0,
    told: true,
    ...overrides,
  };
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

function historyServer(rows: readonly PayoutHistoryRow[] = ROWS, preview: PayoutVoidPreview = voidPreview()) {
  const calls: Call[] = [];
  const route: Route = (url, init): Answer | undefined => {
    const method = init?.method ?? "GET";
    if (url.pathname !== "/api/admin/payout-history" && !/^\/api\/admin\/payouts\/\d+\/void$/.test(url.pathname)) return undefined;
    calls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.pathname === "/api/admin/payout-history") return json(200, { rows, total: 150, page: 1, pageSize: 25, facets: { status: [{ value: "RECORDED", count: 149 }, { value: "VOIDED", count: 1 }] }, summary: { paidAmount: 12345678 }, asOf: "2026-10-30T12:42:00.000Z" });
    if (method === "GET") return json(200, preview);
    return json(200, { payoutId: 41, customerId: "P1", amount: 135216, voidedAt: "2026-10-30T12:50:00.000Z", orders: [{ orderId: "261001A0001", to: "REVERSED" }, { orderId: "261001A0002", to: "APPROVED" }], offsets: 1, corrected: true, replay: false });
  };
  return { route, calls };
}

async function history(session = EMPLOYEE, path = "/admin/payouts/history", server = historyServer()) {
  fakeServer({ session, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, PAYOUT_HISTORY_KEY);
  return { ...view, server };
}

const voidButton = (row: PayoutHistoryRow) => screen.queryByRole("button", { name: adminText("history_void_aria", { payout: row.payoutId, name: row.customerName ?? "" }) });

describe("Story 4.12 acceptance criteria on the desk", () => {
  it("AC1: the summary is the paid sum of the whole filtered set (150 payouts), named as such, with the count; the history tab is selected", async () => {
    await history();
    const summary = screen.getAllByText(adminText("history_count", { count: "150" })).map((n) => n.closest("p")).find((p) => p !== null) as HTMLElement;
    expect(summary).toHaveTextContent(adminText("history_summary_paid"));
    expect(summary).toHaveTextContent(formatMoney(12345678) ?? "");
    expect(screen.getByRole("tab", { name: adminText("payouts_tab_history") })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: adminText("history_receipt_aria", { payout: 41 }) })).toHaveAttribute("href", "/b/rcpt_token_1");
  });

  it("AC2: a voided payout shows the voided badge and its void day, and the summary says voided payouts are left out", async () => {
    await history();
    const row = screen.getByText(ROWS[1]?.customerName ?? "").closest("tr") as HTMLElement;
    expect(within(row).getByText(statusLabel("status_payout_voided"))).toBeInTheDocument();
    // Paid on 30/10 and voided on 30/10: two date columns, one value each.
    expect(within(row).getAllByText("30/10", { selector: "span" })).toHaveLength(2);
  });

  it("AC3: an employee sees no void action; an admin sees it on a recorded row only", async () => {
    const first = await history(EMPLOYEE);
    expect(voidButton(ROWS[0] as PayoutHistoryRow)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: adminText("col_actions") })).toBeNull();
    first.unmount();
    await history(ADMIN);
    expect(voidButton(ROWS[0] as PayoutHistoryRow)).not.toBeNull();
    expect(voidButton(ROWS[1] as PayoutHistoryRow)).toBeNull();
  });

  it("AC4: 'this month' sends the Vietnam month, the whole last day included", async () => {
    const user = userEvent.setup();
    const { server } = await history();
    await user.selectOptions(screen.getByRole("combobox", { name: adminText("col_paid_on") }), uiText("list_date_this_month"));
    await waitFor(() => expect(server.calls.at(-1)?.query["filter[recordedAt]"]).toBe("2026-10-01..2026-10-31"));
  });
});

describe("Story 4.10 on the desk: void from the history", () => {
  it("AC5: the dialog lists each order with the state the server says it returns to; void needs a reason, sends only it, and refreshes every list (LC-10)", async () => {
    const user = userEvent.setup();
    const { server } = await history(ADMIN);
    await user.click(voidButton(ROWS[0] as PayoutHistoryRow) as HTMLElement);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: adminText("void_title", { amount: formatMoney(135216) ?? "" }) })).toBeInTheDocument();
    const lines = await waitFor(() => dialog.querySelector("[data-void-lines]") as HTMLElement);
    const rows = within(lines).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(statusLabel("status_reversed"));
    expect(rows[1]).toHaveTextContent(statusLabel("status_approved"));
    expect(rows[2]).toHaveTextContent(statusLabel("status_campaign_award_void"));
    expect(within(dialog).getByText(adminText("void_told"))).toBeInTheDocument();
    const go = within(dialog).getByRole("button", { name: adminText("void_confirm") });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText(adminText("void_reason")), "Ghi nham khach");
    const before = server.calls.filter((c) => c.path === "/api/admin/payout-history").length;
    await user.click(go);
    expect(await screen.findByText(adminText("history_void_done", { payout: 41 }))).toBeInTheDocument();
    expect(server.calls.filter((c) => c.method === "POST")).toEqual([{ method: "POST", path: "/api/admin/payouts/41/void", query: {}, body: { reason: "Ghi nham khach" } }]);
    await waitFor(() => expect(server.calls.filter((c) => c.path === "/api/admin/payout-history").length).toBeGreaterThan(before));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("review 1 (desk): the dialog shows what is credited back for netting already taken", async () => {
    const user = userEvent.setup();
    await history(ADMIN, "/admin/payouts/history", historyServer(ROWS, voidPreview({ refunded: 14243 })));
    await user.click(voidButton(ROWS[0] as PayoutHistoryRow) as HTMLElement);
    const dialog = await screen.findByRole("alertdialog");
    expect((await within(dialog).findByText(adminText("void_refund"))).closest("div")).toHaveTextContent(formatMoney(14243) ?? "");
  });

  it("on a phone the history is cards with the void action, and the dialog fits the width", async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    await history(ADMIN);
    const cards = document.querySelectorAll("[data-card=payout-history]");
    expect(cards).toHaveLength(2);
    const row = ROWS[0] as PayoutHistoryRow;
    await user.click(within(cards[0] as HTMLElement).getByRole("button", { name: adminText("history_void_aria", { payout: row.payoutId, name: row.customerName ?? "" }) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.className).toContain("w-[calc(100%-2rem)]");
  });
});
