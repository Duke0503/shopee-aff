/**
 * The desk's own screens for what the CLI did before (Stories 4.19, 4.20, 6.11 after cutover):
 * the campaign screen, the staff screen, the merge proposals tab and the merge dialog, and the
 * sidebar counts, which poll on their own and never refetch a list behind an open payout panel.
 */
import { formatMoney } from "@cashback/ui";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CAMPAIGNS_KEY, PREVIEW_DELAY_MS } from "../src/campaigns/campaigns.queries";
import { adminText, errorText } from "../src/labels";
import { MERGES_KEY } from "../src/merges/merges.queries";
import { PAYOUTS_KEY } from "../src/payouts/payouts.queries";
import { COUNTS_KEY } from "../src/shell/desk-counts.queries";
import { STAFF_KEY } from "../src/staff/staff.queries";
import { ADMIN, EMPLOYEE, envelope, fakeServer, json, renderDesk, settle, type Answer, type Route } from "./app-harness";
import DESK from "./fixtures/desk-screens.json";
import { PAYOUT_FIXTURES, payoutRow, payoutServer, payoutsAnswer } from "./payout-fixtures";

type Call = { method: string; path: string; body: unknown };

function deskRoutes(overrides: Partial<Record<string, (body: unknown) => Answer>> = {}) {
  const calls: Call[] = [];
  const route: Route = (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const path = url.pathname;
    const own = overrides[`${method} ${path}`];
    const answers: Record<string, () => Answer> = {
      "GET /api/admin/counts": () => json(200, DESK.counts),
      "GET /api/admin/campaigns": () => json(200, DESK.campaigns),
      "POST /api/admin/campaigns/preview": () => json(200, DESK.campaignPreview),
      "POST /api/admin/campaigns": () => json(200, DESK.campaignPreview),
      "GET /api/admin/staff": () => json(200, DESK.staff),
      "POST /api/admin/staff": () => json(200, { ...DESK.issued, staffId: "s-thao-nguyen", username: "thao.nguyen", sessionsEnded: 0 }),
      "POST /api/admin/staff/minh/password": () => json(200, DESK.issued),
      "POST /api/admin/staff/minh/access": () => json(200, { staffId: "minh", role: "EMPLOYEE", status: "DISABLED" }),
      "GET /api/admin/merges/proposals": () => json(200, DESK.proposals),
      "POST /api/admin/merges/preview": () => json(200, DESK.mergePreview),
      "POST /api/admin/merges": () => json(200, { mergedId: "C64", survivorId: "C31", bankMoves: false, balance: DESK.mergePreview.plan.result }),
      "GET /api/admin/review-cases": () => json(200, { rows: [], total: 0, page: 1, pageSize: 25, facets: {}, summary: {}, asOf: "2026-10-30T12:42:00.000Z", counts: { open: 3, resolved: 41 } }),
    };
    const answer = own === undefined ? answers[`${method} ${path}`] : () => own(body);
    if (answer === undefined) return undefined;
    calls.push({ method, path, body });
    return answer();
  };
  return { route, calls };
}

async function open(path: string, session = ADMIN, routes = deskRoutes(), extra: Route[] = []) {
  fakeServer({ session, routes: [routes.route, ...extra] });
  const view = renderDesk(path);
  return { ...view, calls: routes.calls };
}

describe("sidebar counts", () => {
  it("shows the Payouts payable count and the open review cases beside their items", async () => {
    const view = await open("/admin/");
    await settle(view.queryClient, COUNTS_KEY);
    const nav = screen.getByRole("navigation", { name: adminText("nav_label") });
    expect(within(within(nav).getByRole("link", { name: new RegExp(`^${adminText("nav_payouts")}`) })).getByText("12")).toBeInTheDocument();
    expect(within(within(nav).getByRole("link", { name: new RegExp(`^${adminText("nav_review")}`) })).getByText("3")).toBeInTheDocument();
    expect(nav.querySelectorAll("[data-nav-count]")).toHaveLength(2);
  });

  it("refreshing the counts while a payout panel is open never refetches the list behind it", async () => {
    const user = userEvent.setup();
    const payouts = payoutServer(() => payoutsAnswer([payoutRow(0, { payable: 135216 })], 135216));
    const routes = deskRoutes();
    const view = await open("/admin/payouts", EMPLOYEE, routes, [payouts.route]);
    await settle(view.queryClient, PAYOUTS_KEY);
    const name = PAYOUT_FIXTURES.names[0] ?? "";
    await user.click(screen.getByRole("button", { name: adminText("payout_open_aria", { name }) }));
    await screen.findByRole("dialog");
    const lists = () => payouts.calls.filter((c) => c.method === "GET" && c.path === "/api/admin/payouts").length;
    const before = lists();
    const polls = routes.calls.filter((c) => c.path === "/api/admin/counts").length;
    await act(async () => {
      await view.queryClient.refetchQueries({ queryKey: COUNTS_KEY });
    });
    expect(routes.calls.filter((c) => c.path === "/api/admin/counts").length).toBe(polls + 1);
    expect(lists()).toBe(before);
  });
});

describe("campaign screen", () => {
  it("shows each campaign's state, slots, terms and the event's own result", async () => {
    const view = await open("/admin/campaigns");
    await settle(view.queryClient, [...CAMPAIGNS_KEY, "list"]);
    const card = document.querySelector("[data-campaign=NOV20]") as HTMLElement;
    expect(within(card).getByRole("heading", { name: DESK.campaigns.campaigns[0]?.name ?? "" })).toBeInTheDocument();
    expect(within(card).getByText(adminText("campaign_state_RUNNING"))).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: adminText("campaign_slots_aria", { used: 11, total: 20 }) })).toBeInTheDocument();
    expect(within(card).getByText(adminText("campaign_legend_free", { count: 9 }))).toBeInTheDocument();
    expect(within(card).getByText(/08\/11 00:00/)).toBeInTheDocument();
    expect(within(card).getByText(adminText("campaign_per_customer", { count: 1 }), { exact: false })).toBeInTheDocument();
    expect(card.querySelector("[data-campaign-result]")).toHaveTextContent(formatMoney(160000) ?? "");
    expect(card.querySelectorAll("[data-award]")).toHaveLength(3);
  });

  it("previews the filled form through the server and creates it with the same input", async () => {
    const user = userEvent.setup();
    const view = await open("/admin/campaigns");
    await settle(view.queryClient, [...CAMPAIGNS_KEY, "list"]);
    const form = document.querySelector("[data-campaign-form]") as HTMLElement;
    const fields: [string, string][] = [["campaign_form_name", "Thang 12"], ["campaign_form_id", "DEC15"], ["campaign_form_start", "15/11/2026 00:00"], ["campaign_form_end", "22/11/2026 00:00"], ["campaign_form_slots", "20"], ["campaign_form_bonus", "20000"], ["campaign_form_min", "150000"]];
    for (const [key, value] of fields) await user.type(within(form).getByLabelText(adminText(key as never)), value);
    expect(within(form).getByLabelText(adminText("campaign_form_bonus"))).toHaveValue("20.000");
    const create = within(form).getByRole("button", { name: adminText("campaign_create") });
    await waitFor(() => expect(create).toBeEnabled(), { timeout: PREVIEW_DELAY_MS * 5 });
    expect(form.querySelector("[data-campaign-preview]")).toHaveTextContent(adminText("campaign_preview", { slots: 20, bonus: formatMoney(20000) ?? "", min: formatMoney(150000) ?? "", time: "00:00", date: "22/11" }));
    await user.click(create);
    const posted = view.calls.find((c) => c.method === "POST" && c.path === "/api/admin/campaigns");
    expect(posted?.body).toEqual({ campaign: { campaignId: "DEC15", name: "Thang 12", startsAt: "15/11/2026 00:00", endsAt: "22/11/2026 00:00", slots: 20, bonus: 20000, minOrderValue: 150000, perCustomer: 1, platforms: ["shopee"], excludedCustomers: [] } });
    expect(await within(form).findByRole("status")).toHaveTextContent(adminText("campaign_created", { name: DESK.campaignPreview.name }));
  });

  it("shows the command's refusal under the form and keeps create off", async () => {
    const user = userEvent.setup();
    const routes = deskRoutes({ "POST /api/admin/campaigns/preview": () => envelope(400, "invalid_request", "error.campaign.bad_window") });
    const view = await open("/admin/campaigns", ADMIN, routes);
    await settle(view.queryClient, [...CAMPAIGNS_KEY, "list"]);
    const form = document.querySelector("[data-campaign-form]") as HTMLElement;
    for (const [key, value] of [["campaign_form_name", "X"], ["campaign_form_id", "X1"], ["campaign_form_start", "22/11/2026 00:00"], ["campaign_form_end", "15/11/2026 00:00"], ["campaign_form_slots", "5"], ["campaign_form_bonus", "1000"]] as const) await user.type(within(form).getByLabelText(adminText(key)), value);
    await waitFor(() => expect(form.querySelector("[data-campaign-preview]")).toHaveTextContent(errorText("error.campaign.bad_window", "invalid_request")), { timeout: PREVIEW_DELAY_MS * 5 });
    expect(within(form).getByRole("button", { name: adminText("campaign_create") })).toBeDisabled();
  });

  it("shows an employee the permission line and asks the server nothing", async () => {
    const view = await open("/admin/campaigns", EMPLOYEE);
    expect(await screen.findByText(adminText("admin_only"))).toBeInTheDocument();
    expect(view.calls.filter((c) => c.path.startsWith("/api/admin/campaigns"))).toEqual([]);
  });
});

describe("staff screen", () => {
  it("lists name, role, status and last sign-in; the root admin has no action", async () => {
    const view = await open("/admin/staff");
    await settle(view.queryClient, STAFF_KEY);
    const rows = [...document.querySelectorAll("[data-staff]")] as HTMLElement[];
    expect(rows.map((r) => r.getAttribute("data-staff"))).toEqual(["admin", "minh", "thao"]);
    expect(within(rows[0] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText(adminText("staff_status_ACTIVE"))).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("30/10 18:02")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByRole("button", { name: adminText("staff_enable") })).toBeInTheDocument();
  });

  it("resets a password after one confirmation and shows the issued password once", async () => {
    const user = userEvent.setup();
    const view = await open("/admin/staff");
    await settle(view.queryClient, STAFF_KEY);
    const row = document.querySelector("[data-staff=minh]") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: adminText("staff_reset") }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: adminText("staff_reset_confirm") }));
    const shown = await screen.findByRole("alertdialog", { name: adminText("staff_password_title", { name: "minh" }) });
    expect(within(shown).getByText(DESK.issued.password)).toBeInTheDocument();
    expect(view.calls.filter((c) => c.path === "/api/admin/staff/minh/password")).toEqual([{ method: "POST", path: "/api/admin/staff/minh/password", body: undefined }]);
    await user.click(within(shown).getByRole("button", { name: adminText("staff_password_done") }));
    await waitFor(() => expect(screen.queryByText(DESK.issued.password)).toBeNull());
    expect(JSON.stringify(view.queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(DESK.issued.password);
  });

  it("adds a member with a name and a role, and disables one with its own route", async () => {
    const user = userEvent.setup();
    const view = await open("/admin/staff");
    await settle(view.queryClient, STAFF_KEY);
    await user.click(screen.getByRole("button", { name: adminText("staff_add") }));
    const add = await screen.findByRole("alertdialog");
    await user.type(within(add).getByLabelText(adminText("staff_add_username")), "thao.nguyen");
    await user.click(within(add).getByRole("radio", { name: adminText("staff_role_ADMIN") }));
    await user.click(within(add).getByRole("button", { name: adminText("staff_add_confirm") }));
    expect(await screen.findByText(DESK.issued.password)).toBeInTheDocument();
    expect(view.calls.find((c) => c.method === "POST" && c.path === "/api/admin/staff")?.body).toEqual({ username: "thao.nguyen", role: "ADMIN" });
    await user.click(screen.getByRole("button", { name: adminText("staff_password_done") }));
    await user.click(within(document.querySelector("[data-staff=minh]") as HTMLElement).getByRole("button", { name: adminText("staff_disable") }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: adminText("staff_access_confirm") }));
    await waitFor(() => expect(view.calls.find((c) => c.path === "/api/admin/staff/minh/access")?.body).toEqual({ status: "DISABLED" }));
  });
});

describe("merge proposals and the merge dialog", () => {
  it("gives an admin the proposals tab with its count", async () => {
    const view = await open("/admin/review?filter[status]=MERGES");
    await settle(view.queryClient, [...MERGES_KEY, "proposals"]);
    const tab = screen.getByRole("tab", { name: new RegExp(`^${adminText("review_tab_merges")}`) });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveTextContent("1");
    expect(document.querySelector("[data-merge-proposal=code_claimed]")).toHaveTextContent(adminText("merge_reason_code_claimed", { code: "DP00031" }));
  });

  it("gives an employee no proposals tab and asks the server for none", async () => {
    const employee = await open("/admin/review", EMPLOYEE);
    await screen.findAllByRole("tab");
    expect(screen.queryByRole("tab", { name: new RegExp(`^${adminText("review_tab_merges")}`) })).toBeNull();
    expect(employee.calls.filter((c) => c.path.startsWith("/api/admin/merges"))).toEqual([]);
  });

  it("previews both sides from a proposal and merges the newer record into the older one", async () => {
    const user = userEvent.setup();
    const view = await open("/admin/review?filter[status]=MERGES");
    await settle(view.queryClient, [...MERGES_KEY, "proposals"]);
    await user.click(screen.getByRole("button", { name: adminText("merge_open_aria", { merged: "DP00064", survivor: "DP00031" }) }));
    const dialog = await screen.findByRole("alertdialog", { name: adminText("merge_title") });
    await within(dialog).findByText(adminText("merge_same_bank", { merged: "DP00064", survivor: "DP00031" }));
    expect(dialog.querySelector("[data-merge-side=survivor]")).toHaveTextContent(adminText("merge_side_money", { orders: "7", payable: formatMoney(24860) ?? "" }));
    expect(dialog.querySelector("[data-merge-side=merged]")).toHaveTextContent("Zalo 5530 9921 0018");
    await user.click(within(dialog).getByRole("button", { name: adminText("merge_confirm", { survivor: "DP00031" }) }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(view.calls.filter((c) => c.method === "POST").map((c) => [c.path, c.body])).toEqual([
      ["/api/admin/merges/preview", { merged: "C64", survivor: "C31" }],
      ["/api/admin/merges", { merged: "C64", survivor: "C31" }],
    ]);
  });

  it("shows the bank refusal with both sides and keeps the merge off", async () => {
    const user = userEvent.setup();
    const routes = deskRoutes({ "POST /api/admin/merges/preview": () => json(200, { ...DESK.mergePreview, ...DESK.mergeRefused }) });
    const view = await open("/admin/review?filter[status]=MERGES", ADMIN, routes);
    await settle(view.queryClient, [...MERGES_KEY, "proposals"]);
    await user.click(screen.getByRole("button", { name: adminText("merge_open_aria", { merged: "DP00064", survivor: "DP00031" }) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(errorText("error.merge.bank_differs", "conflict", DESK.mergeRefused.refusal.fields));
    expect(dialog.querySelectorAll("[data-merge-side]")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: adminText("merge_confirm", { survivor: "DP00031" }) })).toBeDisabled();
  });

  it("opens the same dialog from a customer's danger zone after the other code is typed; employees have no merge item", async () => {
    const user = userEvent.setup();
    const PAGE = { customerId: "C31", customerCode: "DP00031", customerName: "Khach", status: "ACTIVE", zaloUserId: null, joinedAt: null, erasedAt: null, balance: { payable: 0, gross: 0, waiting: 0, paid: 0, deductedNext: 0 }, flags: [], bank: null, clawbacks: [], counts: { orders: 0, linkRequests: 0, payouts: 0 } };
    const empty = json(200, { rows: [], total: 0, page: 1, pageSize: 25, facets: {}, summary: {}, asOf: "2026-10-30T12:42:00.000Z" });
    const customer: Route = (url) => (url.pathname === "/api/admin/customers/DP00031" ? json(200, PAGE) : url.pathname.startsWith("/api/admin/customers/DP00031/") ? empty : undefined);
    const view = await open("/admin/customers/DP00031", ADMIN, deskRoutes(), [customer]);
    const zone = (await screen.findByRole("region", { name: adminText("danger_title") })) as HTMLElement;
    await user.click(within(zone).getByRole("button", { name: adminText("danger_merge") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByLabelText(adminText("merge_other_label")), "DP00064");
    await user.click(within(dialog).getByRole("button", { name: adminText("merge_other_check") }));
    await within(dialog).findByText(adminText("merge_same_bank", { merged: "DP00064", survivor: "DP00031" }));
    expect(view.calls.find((c) => c.path === "/api/admin/merges/preview")?.body).toEqual({ merged: "DP00064", survivor: "C31" });
    await open("/admin/customers/DP00031", EMPLOYEE, deskRoutes(), [customer]);
    const employeeZone = (await screen.findAllByRole("region", { name: adminText("danger_title") })).at(-1) as HTMLElement;
    expect(within(employeeZone).queryByRole("button", { name: adminText("danger_merge") })).toBeNull();
    expect(within(employeeZone).getByRole("button", { name: adminText("erase_button") })).toBeInTheDocument();
  });
});
