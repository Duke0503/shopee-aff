/**
 * Stories 7.3 and 7.4 (website side): My money shows the server's figures through the one
 * formatter, the deduction line and the clawed-back orders, the bank card states, the order lines
 * with one date each, the reason of a rejected order in words, the one sort and the chips sent to
 * the server, the payouts with the owner's proof, and distinct empty and error states. Figures come
 * from tests/fixtures/my-money.json; the server side (the figures equal getBalances, the admin page
 * and /sodu; scoping; rows adding up) is in apps/server/tests/my-money.test.ts.
 */
import { MY_MONEY_PATH, MY_ORDERS_PATH, MY_PAYOUTS_PATH, type ListResponse, type MyMoney, type MyOrderRow } from "@cashback/contracts";
import messages from "@cashback/labels/vi/messages.json";
import { fillLabel, formatMoney, statusLabel, uiText } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webText } from "../src/labels";
import { envelope, fakeServer, json, LAN, renderSite, type Answer, type Route } from "./app-harness";
import fixture from "./fixtures/my-money.json";
import { setViewportWidth } from "./viewport";

const FIXTURE: Readonly<Record<string, unknown>> = fixture;
const money = (key: string) => FIXTURE[key] as MyMoney;
const page = <R,>(key: string) => FIXTURE[key] as ListResponse<R>;

// Dates read "12/10" in the fixtures' year; the clock is pinned there (Date only, timers stay real).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-11-02T05:00:00.000Z");
});
afterEach(() => vi.useRealTimers());

interface Answers {
  readonly money?: Answer;
  readonly orders?: (url: URL) => Answer;
  readonly payouts?: Answer;
}

function server({ money: moneyAnswer = json(200, money("money")), orders = () => json(200, page("orders")), payouts = json(200, page("payouts")) }: Answers = {}) {
  const route: Route = (url) => {
    if (url.pathname === MY_MONEY_PATH) return moneyAnswer;
    if (url.pathname === MY_ORDERS_PATH) return orders(url);
    if (url.pathname === MY_PAYOUTS_PATH) return payouts;
    return undefined;
  };
  return fakeServer({ session: LAN, routes: [route] });
}

const card = () => screen.findByRole("region", { name: webText("money_card_label") });
const amountText = (amount: number): string => formatMoney(amount) ?? "";
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const estimateText = (amount: number): RegExp => new RegExp(`${escape(uiText("money_about"))} ${escape(amountText(amount))}\\s*${escape(uiText("money_estimate_tag"))}`);
const cards = () => [...document.querySelectorAll<HTMLElement>("[data-order-line]")];
const found = <T,>(value: T | null): T => {
  if (value === null) throw new Error("not rendered yet");
  return value;
};

describe("Story 7.3: My money shows payable, waiting and paid amounts", () => {
  it("AC1: the three figures are the server's, rendered by the one formatter", async () => {
    server({ money: json(200, money("moneyNoDeduction")) });
    renderSite("/tien-cua-toi");
    const region = await card();
    expect(within(region).getByText(webText("money_payable_label")).closest("a")).toHaveTextContent(amountText(79216));
    expect(within(region).getByText(webText("money_waiting_label")).closest("a")).toHaveTextContent(estimateText(9263));
    expect(within(region).getByText(webText("money_paid_label")).closest("a")).toHaveTextContent(amountText(152000));
    expect(amountText(79216)).toBe(`79.216${uiText("money_sign")}`);
    expect(within(region).queryByText(webText("money_deducted_label"))).toBeNull();
  });

  it("AC2: deductedNext of 9,263 shows the deduction line with minus 9,263 dong and taps through to the clawed-back orders", async () => {
    const user = userEvent.setup();
    const site = server();
    const { router } = renderSite("/tien-cua-toi");
    const line = await waitFor(() => found(document.querySelector<HTMLAnchorElement>("[data-deduction]")));
    expect(line).toHaveTextContent(`${webText("money_deducted_label")}${webText("money_deducted_amount", { amount: amountText(9263) })}`);
    expect(line.textContent).toContain(`−${amountText(9263)}`);
    await user.click(line);
    await waitFor(() => expect(router.state.location.search).toEqual({ view: "deducted" }));
    const list = found(document.querySelector<HTMLElement>("[data-deductions]"));
    expect(within(list).getByRole("button", { name: /260901C0001/ })).toBeInTheDocument();
    expect(within(list).getByText(webText("deducted_amount", { amount: amountText(9263) }))).toBeInTheDocument();
    expect(site.requests.filter((r) => r.url.pathname === MY_ORDERS_PATH)).toHaveLength(1);
  });

  it("AC2: an order cancelled after it was paid, above what is approved: the deduction and what stays owed after it", async () => {
    server({ money: json(200, money("moneyOwed")) });
    renderSite("/tien-cua-toi");
    const region = await card();
    expect(within(region).getByText(webText("money_payable_label")).closest("a")).toHaveTextContent(amountText(0));
    expect(region.querySelector("[data-deduction]")).toHaveTextContent(webText("money_deducted_amount", { amount: amountText(10000) }));
    expect(within(region).getByText(webText("money_owed_after", { amount: amountText(20000) }))).toBeInTheDocument();
  });

  it("AC3: the website never names a customer in a request: the session cookie does", async () => {
    const site = server();
    renderSite("/tien-cua-toi?filter[status]=APPROVED");
    await card();
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    const mine = site.requests.filter((r) => r.url.pathname.startsWith("/api/me/"));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const r of mine) {
      expect(r.method).toBe("GET");
      expect([...r.url.searchParams.keys()].some((k) => /customer/i.test(k))).toBe(false);
      expect(r.url.search).not.toContain("DP00012");
    }
  });

  it("AC4: with money to send and no bank account, the bank card is the one thing to fix, with a button to Account", async () => {
    const user = userEvent.setup();
    server({ money: json(200, money("moneyNoBank")) });
    const { router } = renderSite("/tien-cua-toi");
    const fix = await waitFor(() => found(document.querySelector<HTMLElement>("[data-bank=missing]")));
    expect(fix).toHaveTextContent(webText("bank_missing_title", { amount: amountText(79216) }));
    const buttons = within(fix).getAllByRole("link");
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.pathname).toBe("/tai-khoan"));
    expect(await screen.findByRole("heading", { name: webText("account_page_title") })).toBeInTheDocument();
  });

  it("AC4: a saved account shows the last four digits; a website change waiting for Zalo says so", async () => {
    server({ money: json(200, money("moneyHeld")) });
    renderSite("/tien-cua-toi");
    const held = await waitFor(() => found(document.querySelector<HTMLElement>("[data-bank=held]")));
    expect(held).toHaveTextContent(webText("bank_masked", { lastFour: "4321" }));
    expect(held).toHaveTextContent(webText("bank_held"));
  });

  it("AC5: no text on the page promises a payout date or an automatic transfer (regression: automatic transfer is false)", async () => {
    server();
    renderSite("/tien-cua-toi");
    await card();
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    const text = document.body.textContent ?? "";
    expect(text).toContain(webText("money_note"));
    const rest = text.replace(webText("money_note"), "");
    // "automatic", "24/7", "within", "<n> days", "<n> hours", "on a fixed day".
    for (const promise of [/t\u1ef1 \u0111\u1ed9ng/i, /24\/7/, /trong v\u00f2ng/i, /\d+\s*(-\s*\d+\s*)?ng\u00e0y/i, /\d+\s*gi\u1edd/i, /h\u1eb9n ng\u00e0y/i]) expect(rest).not.toMatch(promise);
  });

  it("tapping a figure opens the rows that add up to it: payable to the approved lines, paid to the payouts", async () => {
    const user = userEvent.setup();
    const site = server({ orders: (url) => json(200, page(url.searchParams.get("filter[status]") === "APPROVED" ? "ordersApproved" : "orders")) });
    const { router } = renderSite("/tien-cua-toi");
    const region = await card();
    await user.click(within(region).getByText(webText("money_payable_label")));
    await waitFor(() => expect(router.state.location.search).toEqual({ "filter[status]": "APPROVED" }));
    await waitFor(() => expect(site.requests.some((r) => r.url.pathname === MY_ORDERS_PATH && r.url.searchParams.get("filter[status]") === "APPROVED")).toBe(true));
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.getByRole("button", { name: new RegExp(`^${statusLabel("status_approved")}`), pressed: true })).toBeInTheDocument();
    await user.click(within(region).getByText(webText("money_paid_label")));
    await waitFor(() => expect(router.state.location.search).toEqual({ view: "payouts" }));
    expect((await screen.findAllByText(webText("payouts_count", { count: "2" }))).length).toBeGreaterThan(0);
  });
});

describe("Sprint 30 review: the customer is never shown misleading money", () => {
  it("an order cancelled after it was paid shows the cancelled badge, the sentence instead of the progress, and its deduction", async () => {
    server();
    renderSite("/tien-cua-toi");
    await waitFor(() => expect(cards()).toHaveLength(6));
    const cancelled = cards()[5] as HTMLElement;
    expect(cancelled).toHaveTextContent(statusLabel("status_reversed"));
    expect(cancelled).not.toHaveTextContent(statusLabel("status_paid"));
    expect(cancelled).toHaveTextContent(messages.order_reversed);
    expect(within(cancelled).queryByRole("list", { name: webText("order_progress") })).toBeNull();
    expect(cancelled).toHaveTextContent(webText("order_deducted", { amount: amountText(9263) }));
    expect(cancelled.querySelector("[data-line-amount]")).toHaveTextContent("–");
  });

  it("the payable figure opens rows that add up to it: approved lines, the deduction and the refunded credit, with the card's total", async () => {
    const user = userEvent.setup();
    server({ orders: (url) => json(200, page(url.searchParams.get("filter[status]") === "APPROVED" ? "ordersApproved" : "orders")) });
    renderSite("/tien-cua-toi");
    const region = await card();
    expect(region.querySelector("[data-figure=money_payable_label]")).toHaveTextContent(amountText(75737));
    await user.click(within(region).getByText(webText("money_payable_label")));
    const breakdown = await screen.findByRole("region", { name: webText("breakdown_label") });
    await waitFor(() => expect(cards()).toHaveLength(2));
    const rows = page<MyOrderRow>("ordersApproved").rows.map((r) => amountText(r.amount ?? 0));
    expect(rows).toEqual([amountText(60000), amountText(20000)]);
    expect(breakdown).toHaveTextContent(`${webText("breakdown_approved")}${amountText(80000)}`);
    expect(breakdown.querySelector("[data-breakdown=deducted]")).toHaveTextContent(webText("money_deducted_amount", { amount: amountText(9263) }));
    expect(breakdown.querySelector("[data-breakdown=refunded]")).toHaveTextContent(webText("money_plus_amount", { amount: amountText(5000) }));
    expect(breakdown.querySelector("[data-breakdown=total]")).toHaveTextContent(`${webText("breakdown_total")}${amountText(75737)}`);
    expect(money("money").balance.approved - money("money").balance.deducted + money("money").balance.refunded).toBe(money("money").balance.payable);
  });

  it("a deduction without an order reads as a deduction, with no order code to copy", async () => {
    server({ money: json(200, money("moneyOwed")) });
    renderSite("/tien-cua-toi?view=deducted");
    const list = await waitFor(() => found(document.querySelector<HTMLElement>("[data-deductions]")));
    await waitFor(() => expect(list.querySelectorAll("li")).toHaveLength(2));
    const [withOrder, without] = [...list.querySelectorAll<HTMLElement>("li")];
    expect(within(withOrder as HTMLElement).getByRole("button", { name: /260902C0009/ })).toBeInTheDocument();
    expect(without).toHaveTextContent(webText("deduction_no_order"));
    expect(within(without as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("with no payout at all, the payouts view shows only its empty text", async () => {
    server({ payouts: json(200, page("payoutsEmpty")) });
    renderSite("/tien-cua-toi?view=payouts");
    expect(await screen.findByText(webText("payouts_empty"))).toBeInTheDocument();
    expect(screen.queryByText(webText("payouts_count", { count: "0" }), { ignore: "script, style, [role=status]" })).toBeNull();
  });
});

describe("Story 7.4: My orders list with states in words", () => {
  it("AC1: each card shows one date with its kind (recorded 12/10); the other dates only in its history", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    server();
    renderSite("/tien-cua-toi");
    await waitFor(() => expect(cards()).toHaveLength(6));
    const approved = cards()[1] as HTMLElement;
    expect(approved).toHaveTextContent(webText("order_date_recorded", { date: "12/10" }));
    expect(approved).not.toHaveTextContent(/20\/10/);
    expect(cards()[4]).toHaveTextContent(webText("order_date_recorded", { date: "18/12/2025" }));
    for (const c of cards()) expect((c.textContent ?? "").match(/\d{2}\/\d{2}/g)).toHaveLength(1);
    await user.click(within(approved).getByRole("button", { name: webText("order_history_show") }));
    const history = found(approved.querySelector<HTMLElement>("dl"));
    expect(history).toHaveTextContent(`${webText("order_history_recorded")}12/10 10:00`);
    expect(history).toHaveTextContent(`${webText("order_history_approved")}20/10 10:00`);
  });

  it("AC2: the sort control changes the order on the server; nothing else looks sortable", async () => {
    const user = userEvent.setup();
    const site = server();
    renderSite("/tien-cua-toi");
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
    const sort = screen.getByRole("combobox", { name: uiText("list_sort_label") });
    expect([...(sort as HTMLSelectElement).options].map((o) => o.text)).toEqual([webText("sort_oldest"), webText("sort_newest")]);
    await user.selectOptions(sort, "recordedAt:asc");
    await waitFor(() => expect(site.requests.some((r) => r.url.pathname === MY_ORDERS_PATH && r.url.searchParams.get("sort") === "recordedAt:asc")).toBe(true));
  });

  it("AC3: a rejected order shows the rejected state with the reason in words instead of the progress", async () => {
    server();
    renderSite("/tien-cua-toi");
    await waitFor(() => expect(cards()).toHaveLength(6));
    const rejected = cards()[3] as HTMLElement;
    expect(rejected).toHaveTextContent(fillLabel(messages.order_rejected, { reason: messages.rejection_reason_order_cancelled }));
    expect(within(rejected).queryByRole("list", { name: webText("order_progress") })).toBeNull();
    const waiting = cards()[0] as HTMLElement;
    expect(within(waiting).getByRole("list", { name: webText("order_progress") })).toBeInTheDocument();
    expect(waiting.querySelector("[data-line-amount]")).toHaveTextContent(estimateText(9263));
  });

  it("AC4: a bonus is its own row, and a paid order cancelled afterwards says what is deducted", async () => {
    server();
    renderSite("/tien-cua-toi");
    await waitFor(() => expect(cards()).toHaveLength(6));
    const bonus = found(document.querySelector<HTMLElement>("[data-order-line=bonus]"));
    const campaign = page<MyOrderRow>("orders").rows.find((r) => r.kind === "bonus")?.campaignName ?? "";
    expect(bonus).toHaveTextContent(webText("order_bonus_title", { campaign }));
    expect(bonus.querySelector("[data-line-amount]")).toHaveTextContent(amountText(20000));
    expect(cards()[5]).toHaveTextContent(webText("order_deducted", { amount: amountText(9263) }));
    expect(screen.getByRole("button", { name: `${statusLabel("status_awaiting_approval")} 1` })).toBeInTheDocument();
  });

  it("AC5: with no orders the empty text links to Home; an error shows the error state, never the empty text", async () => {
    const user = userEvent.setup();
    server({ money: json(200, money("moneyEmpty")), orders: () => json(200, page("ordersEmpty")) });
    const { router, unmount } = renderSite("/tien-cua-toi");
    expect(await screen.findByText(webText("orders_empty"))).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: webText("orders_empty_home") }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    unmount();
    server({ orders: () => envelope(503, "busy", "error.busy") });
    renderSite("/tien-cua-toi");
    expect(await screen.findByText(uiText("list_error_title"))).toBeInTheDocument();
    expect(screen.queryByText(webText("orders_empty"))).toBeNull();
    expect(await card()).toBeInTheDocument();
  });

  it("payout rows: the receipt link, the proof image only on request from the owner-only route, and a voided payout said as such", async () => {
    const user = userEvent.setup();
    server();
    renderSite("/tien-cua-toi?view=payouts");
    const recorded = await waitFor(() => found(document.querySelector<HTMLElement>("[data-payout='1']")));
    expect(within(recorded).getByRole("link", { name: webText("payout_receipt") })).toHaveAttribute("href", "/b/rcpt_demo_token_0001");
    expect(recorded.querySelector("img")).toBeNull();
    await user.click(within(recorded).getByRole("button", { name: webText("payout_proof_show") }));
    expect(recorded.querySelector("img")).toHaveAttribute("src", "/api/me/payouts/1/proof");
    const voided = found(document.querySelector<HTMLElement>("[data-payout='2']"));
    expect(voided).toHaveTextContent(webText("payout_voided_note"));
    expect(within(voided).queryByRole("button", { name: webText("payout_proof_show") })).toBeNull();
  });

  it("a session that ended while the page was open shows the sign-in form, not an error", async () => {
    const unauthorized = envelope(401, "unauthorized", "error.unauthorized");
    const site = fakeServer({
      session: LAN,
      routes: [
        (url) => {
          if (!url.pathname.startsWith("/api/me/")) return undefined;
          site.setSession(null);
          return unauthorized;
        },
      ],
    });
    renderSite("/tien-cua-toi");
    expect(await screen.findByLabelText(webText("sign_in_code"))).toBeInTheDocument();
    expect(document.querySelector("[data-money-error]")).toBeNull();
    expect(site.requests.filter((r) => r.url.pathname === "/api/session").length).toBeGreaterThanOrEqual(2);
  });
});
