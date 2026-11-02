/**
 * Story 7.4, owner request 2026-11-03 (website side): the screens of pen.dev opJFP (one order in
 * full), Gc1Zb (the missing-order report) and the My money parts of ktmGZ, jW4fD and YtS6u (the
 * greeting, the order list's heading with the sort dropdown, the filter button with its count on a
 * phone, chips wider, the range with "show more" and the missing-order link). Every figure is the
 * server's, from tests/fixtures/my-money.json; the server side is apps/server/tests/my-order-detail.test.ts.
 */
import { MY_MISSING_ORDERS_PATH, MY_MONEY_PATH, MY_ORDERS_PATH, myOrderPath, type ListResponse, type MyMoney, type MyOrderDetail, type MyOrderRow } from "@cashback/contracts";
import messages from "@cashback/labels/vi/messages.json";
import { formatMoney, statusLabel, uiText } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorText, webText } from "../src/labels";
import { envelope, fakeServer, json, LAN, renderSite, type Answer } from "./app-harness";
import fixture from "./fixtures/my-money.json";
import { setViewportWidth } from "./viewport";

const FIXTURE: Readonly<Record<string, unknown>> = fixture;
const money = (key: string) => FIXTURE[key] as MyMoney;
const order = (key: string) => FIXTURE[key] as MyOrderDetail;
const page = (key: string) => FIXTURE[key] as ListResponse<MyOrderRow>;
const amountText = (amount: number): string => formatMoney(amount) ?? "";
const minusText = (amount: number): string => webText("money_deducted_amount", { amount: amountText(amount) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-11-02T05:00:00.000Z");
});
afterEach(() => vi.useRealTimers());

interface Answers {
  readonly money?: Answer;
  readonly orders?: (url: URL) => Answer;
  readonly report?: (body: unknown) => Answer;
}

function server({ money: moneyAnswer = json(200, money("money")), orders = () => json(200, page("orders")), report = (body) => json(200, { result: "received", orderId: (body as { orderId: string }).orderId }) }: Answers = {}) {
  const details = Object.fromEntries(["orderApproved", "orderAwaiting", "orderPaid", "orderRejected", "orderReversed"].map((k) => [order(k).orderId, order(k)]));
  return fakeServer({
    session: LAN,
    routes: [
      (url, init) => {
        if (url.pathname === MY_MONEY_PATH) return moneyAnswer;
        if (url.pathname === MY_ORDERS_PATH) return orders(url);
        if (url.pathname.startsWith(`${MY_ORDERS_PATH}/`)) {
          const found = details[decodeURIComponent(url.pathname.slice(MY_ORDERS_PATH.length + 1))];
          return found === undefined ? envelope(404, "not_found", "error.not_found") : json(200, found);
        }
        if (url.pathname === MY_MISSING_ORDERS_PATH) return report(typeof init?.body === "string" ? JSON.parse(init.body) : null);
        return undefined;
      },
    ],
  });
}

const detail = () => waitFor(() => {
  const found = document.querySelector<HTMLElement>("[data-order-detail]");
  if (found === null) throw new Error("not rendered yet");
  return found;
}, { timeout: 5000 });

describe("One order in full (pen.dev opJFP)", () => {
  it("an approved order: product, badge, the server's split line by line, the history with one date per step, the order code chip", async () => {
    server();
    renderSite("/don-hang?ma=261012A0001");
    const view = await detail();
    const facts = order("orderApproved");
    expect(within(view).getByRole("heading", { level: 1 })).toHaveTextContent(facts.productName ?? "");
    expect(view).toHaveTextContent(statusLabel("status_approved"));
    const card = view.querySelector<HTMLElement>("[data-order-money]") as HTMLElement;
    expect(card).toHaveTextContent(`${webText("order_value")}${amountText(1890000)}`);
    expect(card).toHaveTextContent(`${webText("order_commission")}${amountText(75742)}`);
    expect(card).toHaveTextContent(`${webText("order_fee", { rate: "0,98%" })}${minusText(742)}`);
    expect(card).not.toHaveTextContent(webText("order_tax", { rate: "10%" }));
    expect(card).toHaveTextContent(`${webText("order_you_get", { share: "80%" })}${amountText(60000)}`);
    const steps = within(view).getByRole("list", { name: webText("order_progress") });
    expect(steps).toHaveTextContent("12/10 10:00");
    expect(steps).toHaveTextContent("20/10 10:00");
    expect(steps).toHaveTextContent(webText("order_history_paid_todo"));
    expect(steps.querySelectorAll("[data-step=done]")).toHaveLength(2);
    expect(within(view).getByRole("button", { name: uiText("code_copy", { code: "261012A0001" }) })).toBeInTheDocument();
  });

  it("an awaiting order labels every figure as an estimate: the commission as estimated, 'about' on what the customer gets, and the note", async () => {
    server();
    renderSite("/don-hang?ma=261026W0001");
    const card = (await detail()).querySelector<HTMLElement>("[data-order-money]") as HTMLElement;
    expect(card).toHaveTextContent(`${webText("order_commission_estimate")}${amountText(13007)}`);
    expect(card).toHaveTextContent(`${webText("order_tax", { rate: "10%" })}${minusText(1301)}`);
    expect(card).toHaveTextContent(`${webText("order_you_get_estimate", { share: "80%" })}${uiText("money_about")} ${amountText(9263)}`);
    expect(card).toHaveTextContent(webText("order_estimate_note"));
  });

  it("a paid order names the payout that paid it with its receipt", async () => {
    server();
    renderSite("/don-hang?ma=260915P0001");
    const view = await detail();
    expect(view).toHaveTextContent(webText("order_paid_in", { date: "01/10" }));
    expect(within(view).getByRole("link", { name: webText("payout_receipt") })).toHaveAttribute("href", "/b/rcpt_demo_token_0001");
  });

  it("a rejected order says its reason instead of money and steps; a paid order cancelled afterwards says so with its deduction", async () => {
    server();
    const { unmount } = renderSite("/don-hang?ma=261002R0001");
    const rejected = await detail();
    expect(rejected).toHaveTextContent(webText("order_no_money"));
    expect(rejected).toHaveTextContent(messages.rejection_reason_order_cancelled.slice(1));
    expect(within(rejected).queryByRole("list", { name: webText("order_progress") })).toBeNull();
    unmount();
    renderSite("/don-hang?ma=260901C0001");
    const reversed = await detail();
    expect(reversed).toHaveTextContent(messages.order_reversed);
    expect(reversed).toHaveTextContent(webText("order_deducted", { amount: amountText(9263) }));
  });

  it("an order the server does not answer for this customer reads as not found, with the missing-order page next; the way back goes to My money", async () => {
    const user = userEvent.setup();
    server();
    const { router } = renderSite("/don-hang?ma=KHONGCO1234");
    expect(await screen.findByText(webText("order_detail_missing_title"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: webText("orders_missing_link") })).toHaveAttribute("href", "/khong-thay-don");
    await user.click(screen.getByRole("link", { name: webText("order_detail_back") }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/tien-cua-toi"));
  });
});

describe("The missing-order report (pen.dev Gc1Zb)", () => {
  it("sends the self-checks, the order id as the server reads it, the day, the link and the note; the answer replaces the form", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const site = server();
    renderSite("/khong-thay-don");
    expect(await screen.findByRole("heading", { level: 1, name: webText("missing_title") })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: webText("missing_check_zalo") }));
    await user.type(screen.getByLabelText(webText("missing_order_id")), "241028 d9trx");
    await user.type(screen.getByLabelText(webText("missing_link")), "https://shopee.vn/x-i.1.2");
    await user.click(screen.getByRole("button", { name: webText("missing_submit") }));
    await waitFor(() => expect(document.querySelector("[data-missing-answer=received]")).not.toBeNull());
    expect(document.querySelector("[data-missing-answer]")).toHaveTextContent(webText("missing_received_title", { orderId: "241028D9TRX" }));
    const sent = site.requests.find((r) => r.url.pathname === MY_MISSING_ORDERS_PATH);
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toEqual({ orderId: "241028D9TRX", purchasedOn: "2026-11-02", productUrl: "https://shopee.vn/x-i.1.2", note: "", checks: { openedInZalo: true, otherCashbackLink: false, guestLink: false } });
  });

  it("checks the order id before sending and shows the server's field errors under their fields", async () => {
    const user = userEvent.setup();
    const site = server({ report: () => envelope(400, "invalid_request", "error.missing_order.date_rule", { purchasedOn: "error.missing_order.date_rule" }) });
    renderSite("/khong-thay-don");
    await user.click(await screen.findByRole("button", { name: webText("missing_submit") }));
    expect(screen.getByText(webText("missing_order_id_required"))).toBeInTheDocument();
    await user.type(screen.getByLabelText(webText("missing_order_id")), "abc");
    await user.click(screen.getByRole("button", { name: webText("missing_submit") }));
    expect(screen.getByText(errorText("error.missing_order.order_id_rule", "invalid_request"))).toBeInTheDocument();
    expect(site.requests.some((r) => r.url.pathname === MY_MISSING_ORDERS_PATH)).toBe(false);
    await user.clear(screen.getByLabelText(webText("missing_order_id")));
    await user.type(screen.getByLabelText(webText("missing_order_id")), "241028D9TRX");
    await user.click(screen.getByRole("button", { name: webText("missing_submit") }));
    expect(await screen.findByText(errorText("error.missing_order.date_rule", "invalid_request"))).toBeInTheDocument();
    expect(screen.getByLabelText(webText("missing_date"))).toHaveAttribute("aria-invalid", "true");
  });

  it("too many reports today says so; an order already the customer's opens it", async () => {
    const user = userEvent.setup();
    let answer: Answer = envelope(429, "rate_limited", "error.missing_order.too_many");
    server({ report: () => answer });
    const { router } = renderSite("/khong-thay-don");
    await user.type(await screen.findByLabelText(webText("missing_order_id")), "261012A0001");
    await user.click(screen.getByRole("button", { name: webText("missing_submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(errorText("error.missing_order.too_many", "rate_limited"));
    answer = json(200, { result: "already_recorded", orderId: "261012A0001" });
    await user.click(screen.getByRole("button", { name: webText("missing_submit") }));
    await user.click(await screen.findByRole("link", { name: webText("missing_open_order") }));
    await waitFor(() => expect(router.state.location.search).toEqual({ ma: "261012A0001" }));
    expect(await detail()).toBeInTheDocument();
  });
});

describe("My money as pen.dev ktmGZ, jW4fD and YtS6u draw it", () => {
  it("greets the customer by name with the code and the month they joined; without a name, a plain greeting", async () => {
    server();
    const { unmount } = renderSite("/tien-cua-toi");
    expect(await screen.findByRole("heading", { level: 1, name: webText("my_money_greeting", { name: "Lan" }) })).toBeInTheDocument();
    expect(document.querySelector("[data-greeting]")).toHaveTextContent(webText("my_money_joined", { code: "DP00012", month: "09/2026" }));
    unmount();
    server({ money: json(200, money("moneyEmpty")), orders: () => json(200, page("ordersEmpty")) });
    renderSite("/tien-cua-toi");
    expect(await screen.findByRole("heading", { level: 1, name: webText("my_money_greeting_anonymous") })).toBeInTheDocument();
  });

  it("phone: the heading with the sort dropdown, one filter button naming the choice and its count, opening the statuses in a sheet", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    const site = server({ orders: (url) => json(200, page(url.searchParams.get("filter[status]") === "APPROVED" ? "ordersApproved" : "orders")) });
    const { router } = renderSite("/tien-cua-toi");
    await waitFor(() => expect(document.querySelectorAll("[data-order-line]")).toHaveLength(6));
    expect(screen.getByRole("heading", { level: 2, name: webText("view_orders") })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: uiText("list_sort_label") })).toHaveDisplayValue(webText("sort_newest"));
    expect(screen.queryByRole("group", { name: uiText("list_status_group") })).toBeNull();
    const button = screen.getByRole("button", { name: uiText("list_filters_choice", { choice: uiText("list_all"), count: "6" }) });
    await user.click(button);
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: `${statusLabel("status_approved")} 2` }));
    await waitFor(() => expect(router.state.location.search).toEqual({ "filter[status]": "APPROVED" }));
    await waitFor(() => expect(site.requests.some((r) => r.url.searchParams.get("filter[status]") === "APPROVED")).toBe(true));
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: uiText("list_filters_choice", { choice: statusLabel("status_approved"), count: "2" }) })).toBeInTheDocument();
  });

  it("wider: the status chips in short words in line; under the rows the range and the missing-order link", async () => {
    setViewportWidth(768);
    server();
    renderSite("/tien-cua-toi");
    await waitFor(() => expect(document.querySelectorAll("[data-order-line]")).toHaveLength(6));
    const chips = screen.getByRole("group", { name: uiText("list_status_group") });
    expect(within(chips).getByRole("button", { name: `${webText("status_chip_paid")} 1` })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: `${webText("status_chip_rejected")} 1` })).toBeInTheDocument();
    const foot = screen.getByRole("navigation", { name: uiText("list_pagination") });
    expect(foot).toHaveTextContent("1–6 / 6");
    expect(within(foot).queryByRole("button", { name: uiText("list_more") })).toBeNull();
    expect(within(foot).getByRole("link", { name: webText("orders_missing_link") })).toHaveAttribute("href", "/khong-thay-don");
  });

  it("'show more' asks the server for a bigger first page, so the rows already read stay", async () => {
    const user = userEvent.setup();
    const more = { ...page("orders"), total: 26, overall: 26 };
    const site = server({ orders: () => json(200, more) });
    const { router } = renderSite("/tien-cua-toi");
    const foot = await screen.findByRole("navigation", { name: uiText("list_pagination") });
    expect(foot).toHaveTextContent("1–20 / 26");
    await user.click(within(foot).getByRole("button", { name: uiText("list_more") }));
    await waitFor(() => expect(router.state.location.search).toEqual({ pageSize: "40" }));
    await waitFor(() => expect(site.requests.some((r) => r.url.pathname === MY_ORDERS_PATH && r.url.searchParams.get("pageSize") === "40" && (r.url.searchParams.get("page") ?? "1") === "1")).toBe(true));
  });

  it("the payouts open from the paid figure, with their own heading and the way back to the orders", async () => {
    const user = userEvent.setup();
    server();
    const { router } = renderSite("/tien-cua-toi?view=payouts");
    expect(await screen.findByRole("heading", { level: 2, name: webText("view_payouts") })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: webText("payouts_back") }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(myOrderPath("A B")).toBe("/api/me/orders/A%20B");
  });
});
