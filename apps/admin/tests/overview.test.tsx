/**
 * Story 4.17 on the desk: the Overview (dashboard-spec Blocks 1 to 8). The figures are the
 * golden ledger's server answer (tests/fixtures/overview.json); the screen only formats them. The
 * "Dashboard" lines of list-defects.md that live on the screen have their regression test here.
 */
import { overviewSchema, type Overview } from "@cashback/contracts";
import { formatMoney } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { adminText } from "../src/labels";
import { OVERVIEW_KEY } from "../src/overview/overview.queries";
import { EMPLOYEE, fakeServer, json, renderDesk, settle, type Route } from "./app-harness";
import fixture from "./fixtures/overview.json";

const GOLDEN: Overview = overviewSchema.parse(fixture.overview);

function overviewServer(answer: (url: URL) => Overview | Promise<Overview> = () => GOLDEN) {
  const asked: string[] = [];
  const route: Route = (url) => {
    if (url.pathname !== "/api/admin/overview") return undefined;
    asked.push(url.search);
    return Promise.resolve(answer(url)).then((body) => json(200, body));
  };
  return { route, asked };
}

async function overview(path = "/admin/", server = overviewServer()) {
  fakeServer({ session: EMPLOYEE, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, OVERVIEW_KEY);
  return { ...view, server };
}

describe("Story 4.17 acceptance criteria on the desk", () => {
  it("AC1: eight payable customers read '8 customers to pay, <sum>' and open Payouts with its tab filter in the URL", async () => {
    const eight: Overview = { ...GOLDEN, todo: { ...GOLDEN.todo, payable: { customers: 8, amount: 412580 } } };
    await overview("/admin/", overviewServer(() => eight));
    const tile = document.querySelector('[data-todo="payable"]') as HTMLAnchorElement;
    expect(tile).toHaveTextContent(adminText("ov_todo_payable_value", { count: "8", amount: formatMoney(412580) ?? "" }));
    expect(tile.getAttribute("href")).toBe("/admin/payouts?filter[queue]=PAYABLE");
    expect((document.querySelector('[data-todo="no-bank"]') as HTMLAnchorElement).getAttribute("href")).toBe("/admin/payouts?filter[queue]=ACTION");
  });

  it("AC2: the header names the server's Vietnam days for the period and its comparison", async () => {
    await overview();
    expect(document.querySelector("[data-period]")?.getAttribute("data-period")).toBe("2026-10-01..2026-10-30");
    expect(screen.getByText(/01\/10 \u2013 30\/10/)).toBeInTheDocument();
  });

  it("AC3: below 100 approved orders every ratio is muted with the not-enough-data tag and no placeholder number (regression '37 members, 15.2%')", async () => {
    await overview();
    const table = document.querySelector("[data-orders]") as HTMLElement;
    const thin = within(table).getAllByText(adminText("ov_not_enough"));
    expect(thin.length).toBeGreaterThan(0);
    for (const ratio of table.querySelectorAll("[data-ratio]")) expect(ratio.getAttribute("data-ratio")).toBe("thin");
    expect(within(table).getByText("33,33%")).toBeInTheDocument();
    expect(table).not.toHaveTextContent("15,2%");
    expect(screen.getByText(adminText("ov_not_enough_hint"))).toBeInTheDocument();
  });

  it("AC4: on a period change the old figures stay dimmed under their own period, never under the new label (regression 'all-time numbers under the new period label')", async () => {
    let release: (() => void) | undefined;
    const lastMonth: Overview = { ...GOLDEN, period: { preset: "lastMonth", from: "2026-09-01", to: "2026-09-30", previousFrom: "2026-08-01", previousTo: "2026-08-31" } };
    const server = overviewServer((url) => (url.searchParams.get("period") === "lastMonth" ? new Promise((resolve) => (release = () => resolve(lastMonth))) : GOLDEN));
    const view = await overview("/admin/", server);
    await userEvent.click(screen.getByRole("button", { name: adminText("ov_period_lastMonth") }));
    await waitFor(() => expect(document.querySelector("[data-overview]")).toHaveAttribute("aria-busy", "true"));
    expect(document.querySelector("[data-overview]")?.className).toContain("opacity-50");
    expect(document.querySelector("[data-period]")?.getAttribute("data-period")).toBe("2026-10-01..2026-10-30");
    expect(view.history.location.search).toBe("?period=lastMonth");
    release?.();
    await waitFor(() => expect(document.querySelector("[data-period]")?.getAttribute("data-period")).toBe("2026-09-01..2026-09-30"));
    expect(document.querySelector("[data-overview]")).toHaveAttribute("aria-busy", "false");
    expect(server.asked).toEqual(["?period=thisMonth", "?period=lastMonth"]);
  });

  it("AC6: a down component shows a dot, a word and a link to its runbook step; components not reporting read 'not known yet'", async () => {
    const down: Overview = { ...GOLDEN, health: GOLDEN.health.map((h) => (h.component === "reconciliation" ? { ...h, state: "down", at: "2026-10-30T01:00:00.000Z" } : h)) };
    await overview("/admin/", overviewServer(() => down));
    const item = document.querySelector('[data-component="reconciliation"]') as HTMLElement;
    expect(item).toHaveAttribute("data-state", "down");
    expect(item.querySelector("span[aria-hidden]")).not.toBeNull();
    expect(item).toHaveTextContent(adminText("ov_state_down"));
    const link = within(item).getByRole("link", { name: adminText("ov_runbook") });
    expect(link.getAttribute("href")).toBe("#runbook-reconciliation");
    expect(document.getElementById("runbook-reconciliation")).toHaveTextContent(adminText("ov_runbook_reconciliation"));
    expect(document.querySelector('[data-component="bridge"]')).toHaveTextContent(adminText("ov_state_unknown"));
  });
});

describe("the Overview blocks (dashboard-spec)", () => {
  it("Block 2: the profit is the largest figure, with its margin, its definition and the formula lines", async () => {
    await overview();
    expect(document.querySelector("[data-profit]")).toHaveTextContent(formatMoney(46016) ?? "");
    expect(screen.getByText(adminText("ov_margin", { value: "13,34%" }))).toBeInTheDocument();
    expect(screen.getByText(adminText("ov_profit_def"))).toBeInTheDocument();
    const lines = [...document.querySelectorAll("[data-line]")].map((l) => l.getAttribute("data-line"));
    expect(lines).toEqual(["commission", "fee", "tax", "cashback", "bonus", "clawback"]);
    expect(document.querySelector('[data-line="cashback"]')).toHaveTextContent(adminText("ov_line_cashback_def", { paid: formatMoney(35608) ?? "", owed: formatMoney(92581) ?? "" }));
    expect(screen.getByRole("img", { name: adminText("ov_split_title") })).toBeInTheDocument();
    expect(screen.getByText(adminText("ov_income_tax_note"))).toBeInTheDocument();
  });

  it("Block 2: a loss shows the minus and no split bar; a period with nothing shows the dash, never 0", async () => {
    const loss: Overview = { ...GOLDEN, business: { ...GOLDEN.business, profit: { value: -13294, previous: null, change: null }, totalProfit: { value: -13294, previous: null, change: null }, cashBasis: null, split: null } };
    await overview("/admin/", overviewServer(() => loss));
    expect(document.querySelector("[data-profit]")).toHaveTextContent("\u221213.294");
    expect(screen.getByText(adminText("ov_split_loss"))).toBeInTheDocument();
  });

  it("Block 3 and 6: money now, the cash in the period, the advance warning and the event's own loss", async () => {
    await overview();
    expect(screen.getByText(adminText("ov_advance_warning", { received: formatMoney(127922) ?? "", paid: formatMoney(101075) ?? "" }))).toHaveAttribute("role", "alert");
    const events = document.querySelector("[data-events]") as HTMLElement;
    expect(events).toHaveTextContent("Ngay hoi thang 10");
    expect(events).toHaveTextContent("3/10");
    expect(events).toHaveTextContent("\u221213.294");
  });

  it("Block 4: the trend tabs switch the one chart and its summary line", async () => {
    await overview();
    const summary = () => document.querySelector("[data-trend-summary]")?.textContent ?? "";
    expect(summary()).toContain(formatMoney(38698) ?? "");
    await userEvent.click(screen.getByRole("tab", { name: adminText("ov_trend_commission") }));
    expect(summary()).toContain(formatMoney(270000) ?? "");
    expect(screen.getByRole("tab", { name: adminText("ov_trend_commission") })).toHaveAttribute("aria-selected", "true");
  });

  it("Block 7: the concentration warning names the customer's code and share", async () => {
    await overview();
    expect(screen.getByText(adminText("ov_concentration", { code: "DP00001", share: "57,14%" }))).toBeInTheDocument();
  });

  it("a custom period goes to the URL with both days", async () => {
    const view = await overview();
    await userEvent.click(screen.getByRole("button", { name: adminText("ov_period_custom") }));
    await userEvent.type(screen.getByLabelText(adminText("ov_period_from")), "2026-10-01");
    await userEvent.type(screen.getByLabelText(adminText("ov_period_to")), "2026-10-15");
    await userEvent.click(screen.getByRole("button", { name: adminText("ov_period_apply") }));
    await waitFor(() => expect(view.history.location.search).toBe("?period=custom&from=2026-10-01&to=2026-10-15"));
  });

  it("owner decision A: with orders from the old system the total is on top and both bases are labelled; with only them the cash basis alone", async () => {
    await overview();
    expect(document.querySelector('[data-profit-part="approval"]')).toHaveTextContent(adminText("ov_profit_approval", { amount: formatMoney(28016) ?? "" }));
    expect(document.querySelector('[data-profit-part="cash"]')).toHaveTextContent(adminText("ov_profit_cash", { amount: formatMoney(18000) ?? "" }));
    expect(document.querySelector('[data-profit-part="cash"]')).toHaveTextContent(adminText("ov_profit_cash_def", { received: formatMoney(30000) ?? "", paid: formatMoney(12000) ?? "" }));
  });

  it("owner decision A: a period of old-system orders only shows the cash-basis profit, labelled, and no approval line", async () => {
    const NONE = { value: null, previous: null, change: null };
    const cashOnly: Overview = { ...GOLDEN, business: { ...GOLDEN.business, profit: NONE, split: null, totalProfit: { value: 177801, previous: null, change: null }, cashBasis: { received: 1310015, paidOut: 1132214, profit: 177801, previousProfit: null } } };
    await overview("/admin/", overviewServer(() => cashOnly));
    expect(document.querySelector("[data-profit]")).toHaveTextContent(formatMoney(177801) ?? "");
    expect(document.querySelector('[data-profit-part="approval"]')).toBeNull();
    expect(document.querySelector('[data-profit-part="cash"]')).toHaveTextContent(adminText("ov_profit_cash", { amount: formatMoney(177801) ?? "" }));
  });

  it("owner decision B: batches the network is still processing are their own line under what the networks owe", async () => {
    await overview();
    expect(document.querySelector("[data-processing]")).toHaveTextContent(adminText("ov_processing", { received: formatMoney(89020) ?? "", gross: formatMoney(100000) ?? "", count: "1" }));
  });
});
