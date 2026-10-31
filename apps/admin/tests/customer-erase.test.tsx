/**
 * Story 4.16 on the desk: the danger zone of a customer's page and the erased state (FR-35,
 * UX-DR7). The server decides; the page shows why it refuses (the owed amount), lets only an admin
 * force it with a reason, and shows an erased customer with the dash in every personal field and
 * every action switched off.
 */
import type { CustomerPage } from "@cashback/contracts";
import { formatMoney } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CUSTOMERS_KEY } from "../src/customers/customers.queries";
import { adminText, errorText } from "../src/labels";
import { ADMIN, EMPLOYEE, envelope, fakeServer, json, renderDesk, settle, type Answer, type Route } from "./app-harness";

const LIVE: CustomerPage = {
  customerId: "P1",
  customerCode: "DP00012",
  customerName: "Khach Mot",
  status: "ACTIVE",
  zaloUserId: "8812447100912",
  joinedAt: "2026-09-12T03:00:00.000Z",
  erasedAt: null,
  balance: { payable: 79216, gross: 79216, waiting: 0, paid: 212400, deductedNext: 0 },
  flags: [],
  bank: { bankName: "Vietcombank", holderName: "KHACH MOT", lastFour: "3456", changedAt: "2026-10-12T03:00:00.000Z", held: false, changedRecently: false },
  clawbacks: [],
  counts: { orders: 2, linkRequests: 1, payouts: 1 },
};

const ERASED: CustomerPage = { ...LIVE, customerName: null, status: "ERASED", zaloUserId: null, erasedAt: "2026-10-30T12:00:00.000Z", balance: { payable: 0, gross: 0, waiting: 0, paid: 212400, deductedNext: 0 }, bank: null };

const empty = (): Answer => json(200, { rows: [], total: 0, page: 1, pageSize: 25, facets: {}, summary: {}, asOf: "2026-10-30T12:42:00.000Z" });

function eraseServer(page: CustomerPage, erase: (path: string, body: unknown) => Answer = () => json(200, { customerId: "P1", erasedAt: "2026-10-30T12:00:00.000Z", forced: false, mergedRecords: 0 })) {
  const posts: { path: string; body: unknown }[] = [];
  let current = page;
  const route: Route = (url, init) => {
    if ((init?.method ?? "GET") === "POST" && /\/(force-)?erase$/.test(url.pathname)) {
      const body = JSON.parse(String(init?.body)) as unknown;
      posts.push({ path: url.pathname, body });
      const answer = erase(url.pathname, body);
      if (answer.status === 200) current = ERASED;
      return answer;
    }
    if (url.pathname === "/api/admin/customers/DP00012") return json(200, current);
    if (url.pathname.startsWith("/api/admin/customers/DP00012/")) return empty();
    return undefined;
  };
  return { route, posts };
}

async function open(page: CustomerPage, staff = EMPLOYEE, server = eraseServer(page)) {
  fakeServer({ session: staff, routes: [server.route] });
  const view = renderDesk("/admin/customers/DP00012");
  await settle(view.queryClient, [...CUSTOMERS_KEY, "page", "DP00012"]);
  await screen.findByRole("heading", { level: 1 });
  return { ...view, server };
}

const eraseButton = () => within(document.querySelector("[data-danger-zone]") as HTMLElement).getByRole("button", { name: adminText("erase_button") });

describe("Story 4.16 acceptance criteria on the desk", () => {
  it("AC1: an employee sees the owed amount and cannot erase; the server's refusal would say the same", async () => {
    await open(LIVE);
    await userEvent.click(eraseButton());
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(adminText("erase_owed", { payable: formatMoney(79216) ?? "", waiting: formatMoney(0) ?? "" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(adminText("erase_owed_employee"));
    expect(within(dialog).getByRole("button", { name: adminText("erase_force") })).toBeDisabled();
    expect(errorText("error.customer.owed_money", "conflict", { payable: formatMoney(79216) ?? "", waiting: formatMoney(0) ?? "" })).toContain(formatMoney(79216) ?? "");
  });

  it("AC1: an admin forces it only with a reason, sent to the forced erase route", async () => {
    const server = eraseServer(LIVE);
    await open(LIVE, ADMIN, server);
    await userEvent.click(eraseButton());
    const dialog = await screen.findByRole("alertdialog");
    const force = within(dialog).getByRole("button", { name: adminText("erase_force") });
    expect(force).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(adminText("erase_reason")), "customer asked by phone");
    await userEvent.click(force);
    await waitFor(() => expect(server.posts).toEqual([{ path: "/api/admin/customers/DP00012/force-erase", body: { reason: "customer asked by phone" } }]));
  });

  it("AC1: a refusal from the server shows its sentence with the owed amounts", async () => {
    const owedNothing: CustomerPage = { ...LIVE, balance: { ...LIVE.balance, payable: 0, gross: 0 } };
    const server = eraseServer(owedNothing, () => envelope(409, "conflict", "error.customer.owed_money", { payable: "5000", waiting: "12000" }));
    await open(owedNothing, EMPLOYEE, server);
    await userEvent.click(eraseButton());
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: adminText("erase_confirm") }));
    expect(await within(dialog).findByText(errorText("error.customer.owed_money", "conflict", { payable: formatMoney(5000) ?? "", waiting: formatMoney(12000) ?? "" }))).toBeInTheDocument();
    expect(server.posts[0]).toEqual({ path: "/api/admin/customers/DP00012/erase", body: {} });
  });

  it("AC4: an erased customer's header reads the erased title with the date, personal fields show the dash and every action is disabled", async () => {
    await open(ERASED);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(adminText("erased_title", { date: "30/10" }));
    expect(screen.getByText(adminText("erased_note"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(adminText("customer_zalo", { id: "\u2013" })))).toBeInTheDocument();
    const bank = document.querySelector("[data-bank]") as HTMLElement;
    expect(within(bank).getByText("\u2013")).toBeInTheDocument();
    expect(eraseButton()).toBeDisabled();
    expect(screen.queryByRole("link", { name: adminText("customer_go_payout", { amount: formatMoney(0) ?? "" }) })).toBeNull();
  });
});
