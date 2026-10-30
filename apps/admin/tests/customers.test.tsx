/**
 * Story 4.14 on the admin desk: the Customers list and one customer's page. Screen-side regressions
 * of list-defects "Customers (admin)" and "Customer detail dialog": the payable is the server's
 * figure on the row and the page, the previous customer's amount never shows on the next one's page
 * (`UserDetailDialog.tsx:85`), only the last four digits of an account are shown, and on a tablet
 * the secondary columns sit behind the columns menu with the figures unchanged.
 */
import type { AdminCustomerRow, CustomerPage } from "@cashback/contracts";
import { formatMoney, uiText } from "@cashback/ui";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CUSTOMERS_KEY } from "../src/customers/customers.queries";
import { adminText } from "../src/labels";
import {
  EMPLOYEE,
  fakeServer,
  json,
  orderRow,
  ordersAnswer,
  renderDesk,
  settle,
  type Answer,
  type Route,
} from "./app-harness";
import fixtures from "./fixtures/orders.json";
import { setViewportWidth } from "./viewport";

const NAMES = fixtures.customerNames;

function customerRow(n: number, overrides: Partial<AdminCustomerRow> = {}): AdminCustomerRow {
  return {
    customerId: `C${n}`,
    customerCode: `DP${String(n).padStart(5, "0")}`,
    customerName: NAMES[n % NAMES.length] ?? null,
    bankName: "Vietcombank",
    accountLastFour: String(6789 - n).padStart(4, "0"),
    orderCount: 18 - n,
    payable: 79216 - n * 1000,
    paid: 212400,
    flags: "",
    bankChangedAt: null,
    owed: "YES",
    flagged: "NO",
    bank: "SAVED",
    ...overrides,
  };
}

function customerPage(n: number, overrides: Partial<CustomerPage> = {}): CustomerPage {
  const row = customerRow(n);
  return {
    customerId: row.customerId,
    customerCode: row.customerCode,
    customerName: row.customerName,
    status: "ACTIVE",
    zaloUserId: `88124471009${n}`,
    joinedAt: "2026-09-12T03:00:00.000Z",
    balance: {
      payable: row.payable,
      gross: row.payable,
      waiting: 15880,
      paid: 212400,
      deductedNext: 0,
    },
    flags: [],
    bank: {
      bankName: "Vietcombank",
      holderName: "NGUYEN THI LAN",
      lastFour: row.accountLastFour ?? "",
      changedAt: "2026-10-12T03:00:00.000Z",
      held: false,
      changedRecently: false,
    },
    clawbacks: [],
    counts: { orders: 18, linkRequests: 41, payouts: 3 },
    ...overrides,
  };
}

const ROWS = [
  customerRow(1),
  customerRow(2, {
    flags: "BANK_CHANGED",
    flagged: "YES",
    bankChangedAt: "2026-10-29T05:10:00.000Z",
  }),
  customerRow(3, {
    bankName: null,
    accountLastFour: null,
    bank: "NONE",
    flags: "NO_BANK",
    flagged: "YES",
  }),
];

const listAnswer = (rows: readonly AdminCustomerRow[]): Answer =>
  json(200, {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 25,
    facets: {
      owed: [{ value: "YES", count: 12 }],
      flagged: [
        { value: "NO", count: 53 },
        { value: "YES", count: 4 },
      ],
      bank: [],
    },
    summary: { payable: 103076, paid: 637200 },
    asOf: "2026-10-30T12:42:00.000Z",
    overall: 57,
  });

const emptyList = (): Answer =>
  json(200, {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
    facets: {},
    summary: {},
    asOf: "2026-10-30T12:42:00.000Z",
  });

function customersServer(pages: Record<string, () => Answer | Promise<Answer>> = {}) {
  const queries: Record<string, string>[] = [];
  const route: Route = (url) => {
    if (url.pathname === "/api/admin/customers") {
      queries.push(Object.fromEntries(url.searchParams));
      return listAnswer(ROWS);
    }
    const page = /^\/api\/admin\/customers\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (page !== null) return pages[page[1] ?? ""]?.() ?? json(200, customerPage(1));
    if (url.pathname.endsWith("/orders")) return ordersAnswer([orderRow(1), orderRow(2)]);
    if (url.pathname.startsWith("/api/admin/customers/")) return emptyList();
    return undefined;
  };
  return { route, queries };
}

async function customersList(path = "/admin/customers") {
  const server = customersServer();
  fakeServer({ session: EMPLOYEE, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, CUSTOMERS_KEY);
  return { ...view, server };
}

const rowOf = (name: string): HTMLElement =>
  screen
    .getByRole("link", { name: adminText("customer_open_aria", { name }) })
    .closest("tr") as HTMLElement;

describe("Story 4.14 acceptance criteria on the desk", () => {
  it("AC1: one search names the code, the name and the Zalo id, and sends the text as typed for the server to fold", async () => {
    const user = userEvent.setup();
    const { server } = await customersList();
    const box = screen.getByRole("searchbox");
    expect(box).toHaveAttribute("placeholder", adminText("customers_search"));
    await user.type(box, "8812447100{Enter}");
    await waitFor(() => expect(server.queries.at(-1)?.["q"]).toBe("8812447100"));
  });

  it("AC2: the row and the customer page show the server's payable as sent, never a sum of their own", async () => {
    const user = userEvent.setup();
    const server = customersServer({ DP00001: () => json(200, customerPage(1)) });
    fakeServer({ session: EMPLOYEE, routes: [server.route] });
    const view = renderDesk("/admin/customers");
    await settle(view.queryClient, CUSTOMERS_KEY);
    const name = NAMES[1] ?? "";
    expect(within(rowOf(name)).getByText(formatMoney(78216) ?? "")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: adminText("customer_open_aria", { name }) }));
    await waitFor(() => expect(view.history.location.pathname).toBe("/admin/customers/DP00001"));
    const balance = await screen.findByLabelText(adminText("customer_money"));
    expect(within(balance).getByText(formatMoney(78216) ?? "")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: adminText("customer_go_payout", { amount: formatMoney(78216) ?? "" }),
      }),
    ).toHaveAttribute("href", "/admin/payouts?q=DP00001");
  });

  it("AC3: the code header sorts by the customer code; the bank filter and the quick chips use the server's shared definitions and counts", async () => {
    const user = userEvent.setup();
    const { server } = await customersList();
    await user.click(
      screen.getByRole("button", { name: new RegExp(`^${adminText("col_customer_code")}`) }),
    );
    await waitFor(() => expect(server.queries.at(-1)?.["sort"]).toBe("customerCode:asc"));
    await user.selectOptions(
      screen.getByRole("combobox", { name: adminText("customers_bank") }),
      adminText("bank_state_none"),
    );
    await waitFor(() => expect(server.queries.at(-1)?.["filter[bank]"]).toBe("NONE"));
    expect(
      screen.getByRole("button", { name: uiText("list_all_overall", { total: "57" }) }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: `${adminText("customers_chip_flagged")} 4` }),
    );
    await waitFor(() => expect(server.queries.at(-1)?.["filter[flagged]"]).toBe("YES"));
    expect(
      screen.getByRole("button", { name: `${adminText("customers_chip_owed")} 12` }),
    ).toBeInTheDocument();
  });

  it("AC4: opening customer B after A shows none of A's figures while B loads, then only B's (regression UserDetailDialog.tsx:85)", async () => {
    let releaseB: (answer: Answer) => void = () => undefined;
    const server = customersServer({
      DP00001: () =>
        json(
          200,
          customerPage(1, {
            balance: {
              payable: 79216,
              gross: 79216,
              waiting: 15880,
              paid: 212400,
              deductedNext: 0,
            },
          }),
        ),
      DP00002: () => new Promise<Answer>((resolve) => (releaseB = resolve)),
    });
    fakeServer({ session: EMPLOYEE, routes: [server.route] });
    const view = renderDesk("/admin/customers/DP00001");
    expect(await screen.findByText(formatMoney(79216) ?? "")).toBeInTheDocument();
    await act(async () => {
      await view.router.navigate({
        to: "/customers/$customerKey",
        params: { customerKey: "DP00002" },
      });
    });
    expect(screen.queryByText(formatMoney(79216) ?? "")).toBeNull();
    expect(screen.getByRole("status", { name: adminText("customer_loading") })).toBeInTheDocument();
    await act(async () =>
      releaseB(
        json(
          200,
          customerPage(2, {
            balance: { payable: 24860, gross: 24860, waiting: 0, paid: 0, deductedNext: 0 },
          }),
        ),
      ),
    );
    expect(await screen.findByText(formatMoney(24860) ?? "")).toBeInTheDocument();
    expect(screen.queryByText(formatMoney(79216) ?? "")).toBeNull();
  });

  it("AC5: a bank change within 72 hours shows the flag with its change time and the account only as its last four digits", async () => {
    const page = customerPage(1, {
      flags: ["BANK_CHANGED"],
      bank: {
        bankName: "Vietcombank",
        holderName: "NGUYEN THI LAN",
        lastFour: "1234",
        changedAt: "2026-10-29T05:10:00.000Z",
        held: false,
        changedRecently: true,
      },
    });
    fakeServer({
      session: EMPLOYEE,
      routes: [customersServer({ DP00001: () => json(200, page) }).route],
    });
    const { container } = renderDesk("/admin/customers/DP00001");
    const changed = await screen.findByText(
      adminText("customer_bank_changed", { time: "29/10 12:10" }),
    );
    expect(changed).toBeInTheDocument();
    const bank = container.querySelector("[data-bank]") as HTMLElement;
    expect(
      within(bank).getByText(adminText("payout_masked_account", { lastFour: "1234" })),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d{8,}1234/);
    expect(screen.getAllByText(adminText("flag_bank_changed")).length).toBeGreaterThan(0);
  });

  it("AC6: on a tablet the secondary columns sit behind the columns menu and the figures are the same as on desktop", async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    for (const width of [768, 1440]) {
      setViewportWidth(width);
      fakeServer({ session: EMPLOYEE, routes: [customersServer().route] });
      const view = renderDesk("/admin/customers/DP00001");
      const balance = await screen.findByLabelText(adminText("customer_money"));
      seen.push(balance.textContent ?? "");
      await screen.findAllByRole("row");
      const orderHeader = (): HTMLElement | null =>
        screen.queryByRole("columnheader", { name: new RegExp(adminText("col_order_id")) });
      if (width === 768) {
        expect(orderHeader()).toBeNull();
        await user.click(screen.getByRole("button", { name: uiText("list_columns") }));
        await user.click(screen.getByRole("checkbox", { name: adminText("col_order_id") }));
        expect(orderHeader()).not.toBeNull();
      } else {
        expect(orderHeader()).not.toBeNull();
        expect(screen.queryByRole("button", { name: uiText("list_columns") })).toBeNull();
      }
      view.unmount();
    }
    expect(seen[0]).toBe(seen[1]);
  });
});

describe("Story 4.14 customer page tabs", () => {
  it("each tab shows its exact count and keeps its own list state in the URL", async () => {
    const user = userEvent.setup();
    fakeServer({ session: EMPLOYEE, routes: [customersServer().route] });
    const view = renderDesk("/admin/customers/DP00001");
    const links = await screen.findByRole("tab", {
      name: new RegExp(adminText("customer_tab_links")),
    });
    expect(links).toHaveTextContent("41");
    await user.click(links);
    await waitFor(() => expect(view.history.location.search).toBe("?tab=links"));
    expect(await screen.findByText(adminText("customer_links_empty"))).toBeInTheDocument();
  });
});
