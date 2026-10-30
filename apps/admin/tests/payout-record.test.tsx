/**
 * Stories 4.9 and 4.10 on the admin desk: the payout panel takes an optional proof image (JPEG or
 * PNG) and uploads its bytes once the payout is recorded; an admin can void a payout recorded by
 * mistake from a dialog that lists the server's own figures, with a required reason, and every
 * list refreshes after it (LC-10). An employee never sees the void action.
 */
import type { PayoutVoidPreview } from "@cashback/contracts";
import { formatMoney, statusLabel } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { adminText, errorText } from "../src/labels";
import { PAYOUTS_KEY } from "../src/payouts/payouts.queries";
import { ADMIN, EMPLOYEE, envelope, fakeServer, json, renderDesk, settle, type Answer, type Route } from "./app-harness";
import { PAYOUT_FIXTURES, payoutRow, payoutServer, payoutsAnswer } from "./payout-fixtures";
import { setViewportWidth } from "./viewport";

const ROWS = [payoutRow(0, { payable: 135216 })];

function voidPreview(overrides: Partial<PayoutVoidPreview> = {}): PayoutVoidPreview {
  return {
    payoutId: 41,
    customerId: "P0",
    customerCode: "DP00012",
    amount: 135216,
    status: "RECORDED",
    recordedAt: "2026-10-30T12:45:00.000Z",
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

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly type: string | null;
}

/** Answers the proof upload and the void preview and void of payout 41. */
function recordServer(upload: () => Answer = () => json(200, { payoutId: 41, byteSize: 900, width: 48, height: 32, uploadedAt: "2026-10-30T12:45:01.000Z", replaced: false })) {
  const calls: Recorded[] = [];
  const route: Route = (url, init) => {
    const path = url.pathname;
    if (!/^\/api\/admin\/payouts\/\d+\/(proof|void)$/.test(path)) return undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body, type: new Headers(init?.headers).get("content-type") });
    if (path.endsWith("/proof")) return upload();
    if (method === "GET") return json(200, voidPreview());
    return json(200, { payoutId: 41, customerId: "P0", amount: 135216, voidedAt: "2026-10-30T12:50:00.000Z", orders: [{ orderId: "261001A0001", to: "REVERSED" }, { orderId: "261001A0002", to: "APPROVED" }], offsets: 1, corrected: true, replay: false });
  };
  return { route, calls };
}

async function desk(session = EMPLOYEE, upload?: () => Answer) {
  const record = recordServer(upload);
  const payouts = payoutServer(() => payoutsAnswer(ROWS, 135216));
  fakeServer({ session, routes: [record.route, payouts.route] });
  const view = renderDesk("/admin/payouts");
  await settle(view.queryClient, PAYOUTS_KEY);
  return { ...view, record, payouts };
}

async function openFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: adminText("payout_open_aria", { name: PAYOUT_FIXTURES.names[0] ?? "" }) }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText(PAYOUT_FIXTURES.holder);
  return dialog;
}

const confirmButton = () => screen.getByRole("button", { name: adminText("panel_confirm", { amount: formatMoney(135216) ?? "" }) });
const fileInput = (dialog: HTMLElement) => dialog.querySelector("input[type=file]") as HTMLInputElement;

async function recordIt(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(confirmButton());
  await within(dialog).findByText(adminText("panel_recorded", { amount: formatMoney(135216) ?? "" }));
}

describe("Story 4.9 on the desk: the proof image", () => {
  it("AC1 (desk): a JPEG chosen in the panel is uploaded once as its own bytes after the payout is recorded, and the panel says it was saved", async () => {
    const user = userEvent.setup();
    const { record: server } = await desk();
    const dialog = await openFirst(user);
    expect(within(dialog).getByText(adminText("proof_hint"))).toBeInTheDocument();
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "chuyen-khoan.jpg", { type: "image/jpeg" });
    await user.upload(fileInput(dialog), jpeg);
    expect(within(dialog).getByText("chuyen-khoan.jpg")).toBeInTheDocument();
    expect(server.calls).toEqual([]);
    await recordIt(user, dialog);
    expect(await within(dialog).findByText(adminText("proof_saved"))).toBeInTheDocument();
    expect(server.calls.map((c) => [c.method, c.path, c.type])).toEqual([["POST", "/api/admin/payouts/41/proof", "image/jpeg"]]);
    expect(server.calls[0]?.body).toBe(jpeg);
    expect(within(dialog).getByRole("img", { name: adminText("proof_image_alt", { payout: 41 }) })).toHaveAttribute("src", "/api/admin/payouts/41/proof");
  });

  it("AC1 (desk): a GIF is refused in the panel with the server's wording and nothing is sent; a refusal from the server is shown with a retry", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { record: server } = await desk(EMPLOYEE, () => envelope(400, "invalid_request", "error.proof.malformed"));
    const dialog = await openFirst(user);
    await user.upload(fileInput(dialog), new File(["GIF89a"], "anh.gif", { type: "image/gif" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(errorText("error.proof.not_an_image", "invalid_request"));
    await user.upload(fileInput(dialog), new File([new Uint8Array([0x89, 0x50])], "anh.png", { type: "image/png" }));
    await recordIt(user, dialog);
    expect(await within(dialog).findByText(errorText("error.proof.malformed", "invalid_request"), { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: adminText("proof_retry") })).toBeInTheDocument();
    expect(server.calls.map((c) => c.type)).toEqual(["image/png"]);
  });

  it("without a proof the payout records, and the proof can still be added afterwards", async () => {
    const user = userEvent.setup();
    const { record: server } = await desk();
    const dialog = await openFirst(user);
    await recordIt(user, dialog);
    expect(server.calls).toEqual([]);
    await user.upload(fileInput(dialog), new File([new Uint8Array([0xff, 0xd8])], "sau.jpg", { type: "image/jpeg" }));
    await user.click(within(dialog).getByRole("button", { name: adminText("proof_add") }));
    expect(await within(dialog).findByText(adminText("proof_saved"))).toBeInTheDocument();
    expect(server.calls).toHaveLength(1);
  });
});

describe("Story 4.10 on the desk: void", () => {
  it("AC4 (desk): an employee sees no void action after recording; an admin does", async () => {
    const user = userEvent.setup();
    await desk(EMPLOYEE);
    const dialog = await openFirst(user);
    await recordIt(user, dialog);
    expect(within(dialog).queryByRole("button", { name: adminText("void_open") })).toBeNull();
  });

  it("AC5: the dialog lists each order with the state the server says it returns to; void needs a reason, sends only it, and refreshes every list (LC-10)", async () => {
    const user = userEvent.setup();
    const { record: server, payouts } = await desk(ADMIN);
    const panel = await openFirst(user);
    await recordIt(user, panel);
    await user.click(within(panel).getByRole("button", { name: adminText("void_open") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: adminText("void_title", { amount: formatMoney(135216) ?? "" }) })).toBeInTheDocument();
    const lines = await waitFor(() => dialog.querySelector("[data-void-lines]") as HTMLElement);
    const rows = within(lines).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("261001A0001");
    expect(rows[0]).toHaveTextContent(statusLabel("status_reversed"));
    expect(rows[1]).toHaveTextContent(statusLabel("status_approved"));
    expect(rows[2]).toHaveTextContent(statusLabel("status_campaign_award_void"));
    expect(within(dialog).getByText(adminText("void_clawback")).closest("div")).toHaveTextContent(formatMoney(99216) ?? "");
    expect(within(dialog).getByText(adminText("void_told"))).toBeInTheDocument();
    const go = within(dialog).getByRole("button", { name: adminText("void_confirm") });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText(adminText("void_reason")), "   ");
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText(adminText("void_reason")), "Ghi nham khach");
    const listsBefore = payouts.calls.filter((c) => c.method === "GET" && c.path === "/api/admin/payouts").length;
    await user.click(go);
    expect(await within(panel).findByText(adminText("void_done"))).toBeInTheDocument();
    expect(server.calls.filter((c) => c.method === "POST")).toEqual([{ method: "POST", path: "/api/admin/payouts/41/void", body: { reason: "Ghi nham khach" }, type: "application/json" }]);
    await waitFor(() => expect(payouts.calls.filter((c) => c.method === "GET" && c.path === "/api/admin/payouts").length).toBeGreaterThan(listsBefore));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("on a phone the void dialog fits the width and stacks its buttons", async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    await desk(ADMIN);
    const panel = await openFirst(user);
    await recordIt(user, panel);
    await user.click(within(panel).getByRole("button", { name: adminText("void_open") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.className).toContain("w-[calc(100%-2rem)]");
    expect(dialog.className).toContain("max-w-[480px]");
  });
});

describe("Sprint 16 code review on the desk", () => {
  it("review 4: a file over the 8 MB upload limit is refused in the picker with the server's wording and nothing is sent", async () => {
    const user = userEvent.setup();
    const { record: server } = await desk();
    const dialog = await openFirst(user);
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "lon.jpg", { type: "image/jpeg" });
    await user.upload(fileInput(dialog), big);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(errorText("error.proof.too_large", "invalid_request"));
    expect(within(dialog).queryByText("lon.jpg")).toBeNull();
    expect(server.calls).toEqual([]);
  });

  it("review 8: after a file is removed, the same file can be picked again", async () => {
    const user = userEvent.setup();
    await desk();
    const dialog = await openFirst(user);
    const jpeg = new File([new Uint8Array([0xff, 0xd8])], "lai.jpg", { type: "image/jpeg" });
    await user.upload(fileInput(dialog), jpeg);
    expect(fileInput(dialog).value).toBe("");
    await user.click(within(dialog).getByRole("button", { name: adminText("proof_remove") }));
    expect(within(dialog).queryByText("lai.jpg")).toBeNull();
    await user.upload(fileInput(dialog), jpeg);
    expect(within(dialog).getByText("lai.jpg")).toBeInTheDocument();
  });

  it("review 1 (desk): the void dialog shows what is credited back to the customer for netting already taken", async () => {
    const user = userEvent.setup();
    const record = recordServer();
    const route: Route = (url, init) => (url.pathname.endsWith("/void") && (init?.method ?? "GET") === "GET" ? json(200, voidPreview({ refunded: 14243 })) : record.route(url, init));
    fakeServer({ session: ADMIN, routes: [route, payoutServer(() => payoutsAnswer(ROWS, 135216)).route] });
    const view = renderDesk("/admin/payouts");
    await settle(view.queryClient, PAYOUTS_KEY);
    const panel = await openFirst(user);
    await recordIt(user, panel);
    await user.click(within(panel).getByRole("button", { name: adminText("void_open") }));
    const dialog = await screen.findByRole("alertdialog");
    expect((await within(dialog).findByText(adminText("void_refund"))).closest("div")).toHaveTextContent(formatMoney(14243) ?? "");
  });
});
