/**
 * Stories 4.8 and 4.11 on the admin desk: the payout panel's one confirm button sends only the
 * claim id and the snapshot hash, a changed set shows "So tien da thay doi, xem lai" with the new
 * preview and keeps confirm disabled until it is read, a recorded payout replaces the preview, and
 * a netting-only customer opens with no QR and "Xac nhan tru no".
 */
import { formatMoney } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { adminText, errorText } from "../src/labels";
import { PAYOUTS_KEY } from "../src/payouts/payouts.queries";
import { EMPLOYEE, envelope, fakeServer, json, renderDesk, settle, type Answer } from "./app-harness";
import { nettingPreview, PAYOUT_FIXTURES, payoutRow, payoutServer, payoutsAnswer, preview, recorded } from "./payout-fixtures";
import { setViewportWidth } from "./viewport";

type ConfirmFn = Parameters<typeof payoutServer>[3];
type ClaimFn = Parameters<typeof payoutServer>[1];

const ROWS = [payoutRow(0, { payable: 135216 }), payoutRow(3, { payable: 0, flags: "NETTING_ONLY", queue: "ACTION" })];

async function desk(claim?: ClaimFn, confirm?: ConfirmFn, path = "/admin/payouts") {
  const server = payoutServer(() => payoutsAnswer(ROWS, 135216), claim, undefined, confirm);
  fakeServer({ session: EMPLOYEE, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, PAYOUTS_KEY);
  return { ...view, server };
}

const confirmCalls = (s: ReturnType<typeof payoutServer>) => s.calls.filter((c) => c.path.endsWith("/confirm"));
const listCalls = (s: ReturnType<typeof payoutServer>) => s.calls.filter((c) => c.method === "GET" && c.path === "/api/admin/payouts");
const confirmLabel = (amount: number) => adminText("panel_confirm", { amount: formatMoney(amount) ?? "" });

async function openFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: adminText("payout_open_aria", { name: PAYOUT_FIXTURES.names[0] ?? "" }) }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText(PAYOUT_FIXTURES.holder);
  return dialog;
}

describe("Story 4.8 acceptance criteria on the desk", () => {
  it("AC1: the one confirm button states the amount, sends only the claim id and snapshot hash, shows what was recorded and refreshes the list", async () => {
    const user = userEvent.setup();
    const { server } = await desk();
    const dialog = await openFirst(user);
    expect(within(dialog).getByText(adminText("panel_confirm_hint"))).toBeInTheDocument();
    const before = listCalls(server).length;
    await user.click(within(dialog).getByRole("button", { name: confirmLabel(135216) }));
    expect(await within(dialog).findByText(adminText("panel_recorded", { amount: formatMoney(135216) ?? "" }))).toBeInTheDocument();
    expect(confirmCalls(server)).toEqual([{ method: "POST", path: "/api/admin/payout-claims/K7Q2M9XA/confirm", body: { snapshotHash: "a".repeat(64) } }]);
    expect(within(dialog).getByText(adminText("panel_recorded_items", { count: 3 }))).toBeInTheDocument();
    await waitFor(() => expect(listCalls(server).length).toBeGreaterThan(before));
    await user.click(within(dialog).getByRole("button", { name: adminText("panel_done") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.calls.filter((c) => c.path.endsWith("/release"))).toEqual([]);
  });

  it("AC2: a second press while the first is in flight sends nothing more; a replayed answer says it was already recorded", async () => {
    const user = userEvent.setup();
    let answer: (a: Answer) => void = () => undefined;
    const late = new Promise<Answer>((resolve) => (answer = resolve));
    const { server } = await desk(undefined, () => late);
    const dialog = await openFirst(user);
    const button = within(dialog).getByRole("button", { name: confirmLabel(135216) });
    await user.click(button);
    const busy = within(dialog).getByRole("button", { name: adminText("panel_confirming") });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(confirmCalls(server)).toHaveLength(1);
    answer(json(200, recorded({ replay: true })));
    expect(await within(dialog).findByText(adminText("panel_recorded_replay"))).toBeInTheDocument();
  });

  it("AC3: when the server answers that the amount changed, the panel shows 'So tien da thay doi, xem lai' with the new preview and keeps confirm disabled until it is read", async () => {
    const user = userEvent.setup();
    let opens = 0;
    const claim: ClaimFn = () => {
      opens += 1;
      return json(200, opens === 1 ? preview() : preview({ claimId: "N3WCLA1M", snapshotHash: "c".repeat(64), amount: 144479, gross: 144479 }));
    };
    let confirms = 0;
    const { server } = await desk(claim, () => {
      confirms += 1;
      return confirms === 1 ? envelope(409, "conflict", "error.payout.amount_changed") : json(200, recorded({ claimId: "N3WCLA1M", amount: 144479 }));
    });
    const dialog = await openFirst(user);
    await user.click(within(dialog).getByRole("button", { name: confirmLabel(135216) }));
    const notice = await within(dialog).findByText(errorText("error.payout.amount_changed", "conflict"));
    expect(notice.closest("[role=alert]")).toHaveTextContent(adminText("panel_changed_detail", { amount: formatMoney(144479) ?? "", previous: formatMoney(135216) ?? "" }));
    const next = await within(dialog).findByRole("button", { name: confirmLabel(144479) });
    expect(next).toBeDisabled();
    expect(server.calls.filter((c) => c.path.endsWith("/claim"))).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: adminText("panel_changed_ack") }));
    expect(next).toBeEnabled();
    await user.click(next);
    expect(await within(dialog).findByText(adminText("panel_recorded", { amount: formatMoney(144479) ?? "" }))).toBeInTheDocument();
    expect(confirmCalls(server).map((c) => [c.path, c.body])).toEqual([
      ["/api/admin/payout-claims/K7Q2M9XA/confirm", { snapshotHash: "a".repeat(64) }],
      ["/api/admin/payout-claims/N3WCLA1M/confirm", { snapshotHash: "c".repeat(64) }],
    ]);
  });

  it("AC5: the browser never sends an amount or an order list with confirm, and any other refusal is shown with the button kept", async () => {
    const user = userEvent.setup();
    const { server } = await desk(undefined, () => envelope(409, "conflict", "error.payout.confirm_paused"));
    const dialog = await openFirst(user);
    await user.click(within(dialog).getByRole("button", { name: confirmLabel(135216) }));
    expect(await within(dialog).findByText(errorText("error.payout.confirm_paused", "conflict"))).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: confirmLabel(135216) })).toBeEnabled();
    for (const call of confirmCalls(server)) expect(Object.keys(call.body as object)).toEqual(["snapshotHash"]);
  });

  it("on a phone the confirm button stays at the bottom of the drawer", async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    await desk();
    const dialog = await openFirst(user);
    const bar = dialog.querySelector("[data-confirm]") as HTMLElement;
    expect(bar.className).toContain("sticky");
    expect(within(bar).getByRole("button", { name: confirmLabel(135216) })).toBeInTheDocument();
  });
});

describe("Story 4.11 acceptance criteria on the desk", () => {
  it("AC1: the netting-only panel shows 'Xac nhan tru no', no QR and a transfer of 0, with the gross, what is netted and what is still owed", async () => {
    const user = userEvent.setup();
    const { server } = await desk(() => json(200, nettingPreview()), () => json(200, recorded({ claimId: "N3TT1NG0", customerId: "P3", amount: 0, netted: 50000, nettingOnly: true, orderCount: 1, awardCount: 1, receiptToken: null })), "/admin/payouts?filter[queue]=ACTION");
    await user.click(screen.getByRole("button", { name: adminText("payout_open_netting_aria", { name: PAYOUT_FIXTURES.names[3] ?? "" }) }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(adminText("panel_netting_only"))).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: adminText("panel_title_netting", { name: PAYOUT_FIXTURES.names[3] ?? "" }) })).toBeInTheDocument();
    expect(within(dialog).queryByRole("img")).toBeNull();
    const facts = dialog.querySelector("[data-facts=netting]") as HTMLElement;
    expect(within(facts).getByText(adminText("panel_transfer")).closest("div")).toHaveTextContent(formatMoney(0) ?? "");
    expect(within(facts).getByText(adminText("panel_gross")).closest("div")).toHaveTextContent(formatMoney(50000) ?? "");
    expect(within(facts).getByText(adminText("panel_netted")).closest("div")).toHaveTextContent(formatMoney(50000) ?? "");
    expect(within(facts).getByText(adminText("panel_carried")).closest("div")).toHaveTextContent(formatMoney(30000) ?? "");
    expect(within(dialog).queryByRole("button", { name: adminText("panel_copy_account") })).toBeNull();
    expect(within(dialog).getByText(adminText("panel_confirm_netting_hint"))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: adminText("panel_confirm_netting") }));
    expect(await within(dialog).findByText(adminText("panel_recorded_netting", { amount: formatMoney(50000) ?? "" }))).toBeInTheDocument();
    expect(confirmCalls(server)).toEqual([{ method: "POST", path: "/api/admin/payout-claims/N3TT1NG0/confirm", body: { snapshotHash: "b".repeat(64) } }]);
  });
});

describe("Sprint 15 code review on the desk", () => {
  it("review 4: the panel decides 'netting only' from the preview's amount, not from the list row's flags", async () => {
    const user = userEvent.setup();
    await desk(() => json(200, preview()), undefined, "/admin/payouts?filter[queue]=ACTION");
    await user.click(screen.getByRole("button", { name: adminText("payout_open_netting_aria", { name: PAYOUT_FIXTURES.names[3] ?? "" }) }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: confirmLabel(135216) })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: adminText("panel_title", { name: PAYOUT_FIXTURES.names[3] ?? "" }) })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: adminText("panel_confirm_netting") })).toBeNull();
  });

  it("review 4: a row without the netting flag whose preview is 0 opens as netting only", async () => {
    const user = userEvent.setup();
    await desk(() => json(200, nettingPreview()));
    await user.click(screen.getByRole("button", { name: adminText("payout_open_aria", { name: PAYOUT_FIXTURES.names[0] ?? "" }) }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: adminText("panel_confirm_netting") })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: adminText("panel_title_netting", { name: PAYOUT_FIXTURES.names[0] ?? "" }) })).toBeInTheDocument();
  });
});
