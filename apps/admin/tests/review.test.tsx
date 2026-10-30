/**
 * Story 4.15 on the admin desk: the review queue and the review case panel over the Story 3.9
 * commands. The chips and tab counts are the server's, rows stay in the server's oldest-first
 * order, the report row is read only, apply shows the server's resulting state before the one
 * confirm, a refusal keeps the case open with the label file's sentence, every view that shows
 * the changed records refreshes, and on phone the panel is a drawer.
 */
import {
  REVIEW_CASE_REASONS,
  type ReviewCaseDetail,
  type ReviewCaseRow,
} from "@cashback/contracts";
import { statusLabel } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CUSTOMERS_KEY } from "../src/customers/customers.queries";
import { adminText, errorText } from "../src/labels";
import { ORDERS_KEY } from "../src/orders/orders.queries";
import { PAYOUTS_KEY } from "../src/payouts/payouts.queries";
import { reasonLabel, reasonWhy } from "../src/review/review-text";
import { OVERVIEW_KEY, REVIEW_KEY } from "../src/review/review.queries";
import {
  EMPLOYEE,
  envelope,
  fakeServer,
  json,
  renderDesk,
  settle,
  type Answer,
  type Route,
} from "./app-harness";
import { setViewportWidth } from "./viewport";

function caseRow(caseId: number, overrides: Partial<ReviewCaseRow> = {}): ReviewCaseRow {
  return {
    caseId,
    network: "shopee",
    subject: `24102${caseId}F3HQ`,
    orderId: null,
    reason: "unattributed_sub_id1",
    status: "OPEN",
    resolution: null,
    openedAt: `2026-10-2${caseId}T03:00:00.000Z`,
    resolvedAt: null,
    ...overrides,
  };
}

const ROWS = [
  caseRow(1),
  caseRow(2, { reason: "unknown_status", orderId: "241022F3HQ" }),
  caseRow(3, { reason: "settlement_mismatch", subject: "payout:1033120" }),
];

function detailOf(row: ReviewCaseRow, overrides: Partial<ReviewCaseDetail> = {}): ReviewCaseDetail {
  return {
    ...row,
    resolutionReason: null,
    order: null,
    facts: [
      { key: "orderId", kind: "code", value: row.subject, detail: null },
      { key: "networkStatus", kind: "orderStatus", value: "APPROVED", detail: "completed" },
      { key: "subId1", kind: "code", value: "C0042", detail: null },
      { key: "subId2", kind: "code", value: "R26102714023", detail: null },
      { key: "orderValue", kind: "money", value: 389000, detail: null },
      { key: "reportedCommission", kind: "money", value: 8210, detail: null },
    ],
    candidates: [
      {
        customerId: "C31",
        customerCode: "DP00031",
        customerName: "Khoa",
        recentOrders: [
          {
            orderId: "261020C1OLD1",
            productName: "Product",
            productImageUrl: null,
            status: "APPROVED",
            cashback: 9263,
            recordedAt: "2026-10-20T03:00:00.000Z",
          },
        ],
      },
    ],
    applicable: row.reason !== "settlement_mismatch",
    frozen: false,
    ...overrides,
  };
}

interface Options {
  readonly rows?: readonly ReviewCaseRow[];
  readonly apply?: () => Answer;
}

function reviewServer({
  rows = ROWS,
  apply = () => json(200, { caseId: 1, orderId: rows[0]?.subject ?? null, resolution: "APPLIED" }),
}: Options = {}) {
  const queries: Record<string, string>[] = [];
  let applied = false;
  const route: Route = (url, init) => {
    if (url.pathname === "/api/admin/review-cases") {
      queries.push(Object.fromEntries(url.searchParams));
      const shown = applied ? rows.slice(1) : rows;
      const facets = {
        reason: [...new Set(shown.map((r) => r.reason))].map((value) => ({
          value,
          count: shown.filter((r) => r.reason === value).length,
        })),
      };
      return json(200, {
        rows: shown,
        total: shown.length,
        page: 1,
        pageSize: 25,
        facets,
        summary: {},
        asOf: "2026-10-30T12:42:00.000Z",
        counts: { open: shown.length, resolved: applied ? 42 : 41 },
      });
    }
    const one = /^\/api\/admin\/review-cases\/(\d+)$/.exec(url.pathname);
    if (one !== null) {
      const row = rows.find((r) => r.caseId === Number(one[1]));
      if (row === undefined) return envelope(404, "not_found", "error.review_case.case_not_found");
      return json(
        200,
        detailOf(
          row,
          applied && row.caseId === 1
            ? {
                status: "RESOLVED",
                resolution: "APPLIED",
                resolvedAt: "2026-10-30T12:45:00.000Z",
                resolutionReason: "Link R26102714023",
              }
            : {},
        ),
      );
    }
    if (url.pathname.endsWith("/preview"))
      return json(200, {
        caseId: 1,
        orderId: rows[0]?.subject,
        customerId: "C31",
        customerCode: "DP00031",
        from: null,
        to: "AWAITING_APPROVAL",
        cashback: null,
      });
    if (url.pathname.endsWith("/apply") && init?.method === "POST") {
      const answer = apply();
      if (answer.status === 200) applied = true;
      return answer;
    }
    return undefined;
  };
  return { route, queries };
}

async function queue(options: Options = {}, path = "/admin/review") {
  const server = reviewServer(options);
  const fake = fakeServer({ session: EMPLOYEE, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, REVIEW_KEY);
  return { ...view, server, fake };
}

async function openCase(name: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: adminText("review_open_aria", { subject: name }) }),
  );
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText(adminText("review_facts_title"));
  return { user, dialog };
}

describe("Story 4.15 acceptance criteria on the desk", () => {
  it("AC1: the reason chips and the tab totals are the server's counts of the same set, and rows keep the oldest-first order", async () => {
    const { server } = await queue();
    expect(server.queries.at(-1)).toMatchObject({ "filter[status]": "OPEN" });
    expect(server.queries.at(-1)?.["sort"]).toBeUndefined();
    expect(
      screen.getByRole("tab", { name: new RegExp(adminText("review_tab_open")) }),
    ).toHaveTextContent("3");
    expect(
      screen.getByRole("tab", { name: new RegExp(adminText("review_tab_resolved")) }),
    ).toHaveTextContent("41");
    expect(
      screen.getByRole("button", { name: `${reasonLabel("unknown_status")} 1` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(`^${reasonLabel("cancel_after_payout")}`) }),
    ).toBeNull();
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent(reasonLabel("unattributed_sub_id1"));
    expect(bodyRows[2]).toHaveTextContent(adminText("review_subject_payout", { id: "1033120" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: `${reasonLabel("unknown_status")} 1` }));
    await waitFor(() => expect(server.queries.at(-1)?.["filter[reason]"]).toBe("unknown_status"));
  });

  it("AC2: the report row is a read-only list of facts with the candidate and recent orders; no field edits an amount or picks another customer", async () => {
    await queue();
    const { user, dialog } = await openCase(ROWS[0]?.subject ?? "");
    expect(
      within(dialog).getByText((text) => text.startsWith(reasonWhy("unattributed_sub_id1") ?? "-")),
    ).toBeInTheDocument();
    const facts = dialog.querySelector("[data-review-facts]") as HTMLElement;
    expect(
      within(facts).getByText(adminText("review_fact_reportedCommission")),
    ).toBeInTheDocument();
    expect(within(facts).queryAllByRole("textbox")).toEqual([]);
    expect(within(dialog).getByText("DP00031")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: adminText("review_apply") }));
    expect(within(dialog).queryAllByRole("spinbutton")).toEqual([]);
    expect(within(dialog).queryAllByRole("combobox")).toEqual([]);
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    expect(within(dialog).getByRole("textbox")).toHaveAccessibleName(
      adminText("review_reason_label"),
    );
  });

  it("AC3: apply with a reason first shows the server's resulting state, then after confirm the case leaves the list and every view refreshes", async () => {
    const view = await queue();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    const { user, dialog } = await openCase(ROWS[0]?.subject ?? "");
    await user.click(within(dialog).getByRole("button", { name: adminText("review_apply") }));
    const preview = within(dialog).getByRole("button", {
      name: adminText("review_preview_button"),
    });
    expect(preview).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "Link R26102714023");
    await user.click(preview);
    expect(
      await within(dialog).findByText(
        adminText("review_preview_owner", {
          code: "DP00031",
          status: statusLabel("status_awaiting_approval"),
        }),
      ),
    ).toBeInTheDocument();
    expect(view.fake.requests.filter((r) => r.url.pathname.endsWith("/apply"))).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: adminText("review_apply_confirm") }),
    );
    await waitFor(() =>
      expect(view.fake.requests.find((r) => r.url.pathname.endsWith("/apply"))?.body).toEqual({
        reason: "Link R26102714023",
      }),
    );
    expect(await within(dialog).findByText(/Link R26102714023$/)).toBeInTheDocument();
    for (const key of [REVIEW_KEY, ORDERS_KEY, PAYOUTS_KEY, CUSTOMERS_KEY, OVERVIEW_KEY])
      expect(spy).toHaveBeenCalledWith({ queryKey: key });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: new RegExp(adminText("review_tab_open")) }),
      ).toHaveTextContent("2"),
    );
  });

  it("AC4: an apply the server refuses shows the label file's reason and the case stays open; a network payout case offers dismiss only", async () => {
    await queue({ apply: () => envelope(409, "conflict", "error.review_case.order_paid") });
    const { user, dialog } = await openCase(ROWS[0]?.subject ?? "");
    await user.click(within(dialog).getByRole("button", { name: adminText("review_apply") }));
    await user.type(within(dialog).getByRole("textbox"), "checked");
    await user.click(
      within(dialog).getByRole("button", { name: adminText("review_preview_button") }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: adminText("review_apply_confirm") }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      errorText("error.review_case.order_paid", "conflict"),
    );
    expect(within(dialog).getByText(statusLabel("status_review_case_open"))).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const second = await openCase("payout:1033120");
    expect(within(second.dialog).getByText(adminText("review_dismiss_only"))).toBeInTheDocument();
    expect(
      within(second.dialog).queryByRole("button", { name: adminText("review_apply") }),
    ).toBeNull();
    expect(
      within(second.dialog).getByRole("button", { name: adminText("review_dismiss") }),
    ).toBeInTheDocument();
  });

  it("AC5: an empty queue reads the review_empty_open sentence, and on phone the panel is a drawer", async () => {
    const empty = await queue({ rows: [] });
    expect(screen.getByText(adminText("review_empty_open"))).toBeInTheDocument();
    empty.unmount();
    setViewportWidth(390);
    await queue();
    const { dialog } = await openCase(ROWS[0]?.subject ?? "");
    expect(dialog.querySelector("[data-panel=drawer]")).not.toBeNull();
  });
});

describe("Story 4.15 review follow-ups", () => {
  it("the panel speaks plain words: 'Đơn <id>' as title, the link and its maker in a sentence, the network status in the order words with its raw word only as a detail", async () => {
    await queue();
    const { dialog } = await openCase(ROWS[0]?.subject ?? "");
    expect(
      within(dialog).getByRole("heading", {
        name: adminText("review_panel_title", { subject: ROWS[0]?.subject ?? "" }),
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText((text) =>
        text.endsWith(adminText("review_why_hint", { link: "R26102714023", code: "DP00031" })),
      ),
    ).toBeInTheDocument();
    const facts = dialog.querySelector("[data-review-facts]") as HTMLElement;
    expect(within(facts).getByText(adminText("review_fact_subId1"))).toBeInTheDocument();
    expect(within(facts).getByText(adminText("review_fact_subId2"))).toBeInTheDocument();
    expect(within(facts).getByText(statusLabel("status_approved"))).toBeInTheDocument();
    expect(
      within(facts).getByText(adminText("review_fact_raw", { raw: "completed" })),
    ).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/sub_id/);
    expect(reasonLabel("unattributed_sub_id1")).not.toMatch(/sub_id/);
  });

  it("at 390 the panel body scrolls on its own above the actions, so every candidate is reachable and never under the reason field", async () => {
    setViewportWidth(390);
    await queue();
    const { user, dialog } = await openCase(ROWS[0]?.subject ?? "");
    await user.click(within(dialog).getByRole("button", { name: adminText("review_apply") }));
    const body = dialog.querySelector("[data-review-body]") as HTMLElement;
    const footer = dialog.querySelector("[data-review-footer]") as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("flex-1");
    expect(body.querySelector("[data-candidate=C31]")).not.toBeNull();
    expect(footer.contains(within(dialog).getByRole("textbox"))).toBe(true);
    expect(body.contains(footer) || footer.contains(body)).toBe(false);
    expect(footer.className).not.toMatch(/sticky|absolute|fixed/);
  });
});

describe("Story 4.15 words", () => {
  it("every case reason has a short name and a sentence in the label file", () => {
    for (const reason of REVIEW_CASE_REASONS) {
      expect(reasonLabel(reason), reason).not.toContain("review_reason_");
      expect(reasonWhy(reason), reason).toBeTruthy();
    }
  });
});
