/**
 * Stories 4.6 and 4.7 on the admin desk: the Payouts tabs and list show the server's figures only,
 * flagged customers sit in "Cần xử lý", the same customer has the same amount at every width, and
 * the payout panel claims, previews with the VietQR and keeps its snapshot while open.
 */
import { formatMoney } from "@cashback/ui";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { adminText } from "../src/labels";
import { qrPath } from "../src/payouts/vietqr-code";
import { PAYOUTS_KEY } from "../src/payouts/payouts.queries";
import { CopyButton } from "../src/payouts/copy-button";
import { ADMIN, EMPLOYEE, envelope, fakeServer, json, renderDesk, settle } from "./app-harness";
import { PAYOUT_FIXTURES, payoutRow, payoutServer, payoutsAnswer, preview } from "./payout-fixtures";
import { setViewportWidth } from "./viewport";

const ROWS = [payoutRow(0, { payable: 135216, settlement: "PARTLY_SETTLED", settledCount: 1 }), payoutRow(1, { payable: 24860 }), payoutRow(2, { payable: 9263, claimStaffId: "stf_1", claimStaffName: "minh" })];
const SUM = 135216 + 24860 + 9263;
const listCalls = (s: ReturnType<typeof payoutServer>) => s.calls.filter((c) => c.method === "GET" && c.path === "/api/admin/payouts");
const claimCalls = (s: ReturnType<typeof payoutServer>) => s.calls.filter((c) => c.path.endsWith("/claim"));

async function desk(path = "/admin/payouts", claim?: Parameters<typeof payoutServer>[1], session = EMPLOYEE, account?: Parameters<typeof payoutServer>[2]) {
  const server = payoutServer((url) => (url.searchParams.get("filter[queue]") === "ACTION" ? payoutsAnswer([payoutRow(4, { flags: "NO_BANK", queue: "ACTION", bankName: null, accountLastFour: null }), payoutRow(5, { flags: "BANK_CHANGED,SHARED_BANK", queue: "ACTION", bankChangedAt: "2026-10-29T05:00:00.000Z" }), payoutRow(3, { flags: "NETTING_ONLY", queue: "ACTION", payable: 0 })], 50000) : payoutsAnswer(ROWS, SUM)), claim, account);
  fakeServer({ session, routes: [server.route] });
  const view = renderDesk(path);
  await settle(view.queryClient, PAYOUTS_KEY);
  return { ...view, server };
}

const rowOf = (name: string) => screen.getByText(name).closest("tr, article") as HTMLElement;

describe("Story 4.6 acceptance criteria on the desk", () => {
  it("AC1: rows show the server's payable and the summary 'N khach, X d' is the list's own total and sum", async () => {
    const { server } = await desk();
    expect(listCalls(server)[0]?.path).toBe("/api/admin/payouts");
    expect(server.calls.find((c) => c.path === "/api/admin/payouts" && c.method === "GET")).toBeDefined();
    expect(within(rowOf(PAYOUT_FIXTURES.names[0] ?? "")).getByText(formatMoney(135216) ?? "")).toBeInTheDocument();
    expect(screen.getAllByText(adminText("payouts_count", { count: 3 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatMoney(SUM) ?? "").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: new RegExp(adminText("payouts_tab_payable")) })).toHaveAttribute("aria-selected", "true");
  });

  it("AC2: there is no 'show awaiting orders' toggle and no list request can ask for awaiting money", async () => {
    const { server } = await desk();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    for (const call of listCalls(server)) expect(call.path).toBe("/api/admin/payouts");
    const fetched = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/admin/payouts?"));
    for (const url of fetched) expect(new URLSearchParams(url.split("?")[1]).get("filter[queue]")).toMatch(/^(PAYABLE|ACTION)$/);
    expect(fetched.join(" ")).not.toMatch(/await|status|test/i);
  });

  it("AC3: 'Can xu ly' shows each flagged customer with its flag badges, never hidden, and its tab is in the URL", async () => {
    const user = userEvent.setup();
    const { history } = await desk();
    await user.click(screen.getByRole("tab", { name: new RegExp(adminText("payouts_tab_action")) }));
    await waitFor(() => expect(history.location.search).toBe("?filter[queue]=ACTION"));
    expect(await screen.findByText(adminText("flag_no_bank"))).toBeInTheDocument();
    const flagged = rowOf(PAYOUT_FIXTURES.names[5] ?? "");
    expect(within(flagged).getByText(adminText("flag_bank_changed"))).toBeInTheDocument();
    expect(within(flagged).getByText(adminText("flag_shared_bank"))).toBeInTheDocument();
    expect(within(rowOf(PAYOUT_FIXTURES.names[4] ?? "")).getByText(adminText("payout_blocked"))).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: new RegExp(adminText("payouts_tab_action")) })).toHaveTextContent("3");
  });

  it("AC4: the same customer shows the same amount on phone, tablet and desktop", async () => {
    const seen: string[] = [];
    for (const width of [390, 768, 1440]) {
      setViewportWidth(width);
      const view = await desk();
      seen.push(within(rowOf(PAYOUT_FIXTURES.names[0] ?? "")).getByText(formatMoney(135216) ?? "").textContent ?? "");
      view.unmount();
    }
    expect(new Set(seen)).toEqual(new Set([formatMoney(135216)]));
  });

  it("AC5: a partly settled customer is listed with settlement as its own badge", async () => {
    await desk();
    expect(within(rowOf(PAYOUT_FIXTURES.names[0] ?? "")).getByText(adminText("settlement_partly", { settled: 1, total: 2 }))).toBeInTheDocument();
  });

  it("a row another staff member holds reads '<name> dang chuyen' with no open button", async () => {
    await desk();
    const held = rowOf(PAYOUT_FIXTURES.names[2] ?? "");
    expect(within(held).getByText(adminText("payout_taken", { name: "minh" }))).toBeInTheDocument();
    expect(within(held).queryByRole("button", { name: /^Chuy/ })).toBeNull();
  });
});

describe("Story 4.7 acceptance criteria on the desk", () => {
  it("AC1: opening a row claims with an empty body and shows orders, bonus, total, bank, holder, masked account, reference and the VietQR of the server's payload", async () => {
    const user = userEvent.setup();
    const { server } = await desk();
    await user.click(within(rowOf(PAYOUT_FIXTURES.names[0] ?? "")).getByRole("button", { name: adminText("payout_open_aria", { name: PAYOUT_FIXTURES.names[0] ?? "" }) }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(PAYOUT_FIXTURES.holder);
    expect(claimCalls(server)).toEqual([{ method: "POST", path: "/api/admin/payouts/P0/claim", body: {} }]);
    expect(within(dialog).getByText(PAYOUT_FIXTURES.products[0] ?? "")).toBeInTheDocument();
    expect(within(dialog).getByText(adminText("panel_bonus", { campaign: PAYOUT_FIXTURES.campaign }))).toBeInTheDocument();
    expect(within(dialog).getByText(formatMoney(135216) ?? "")).toBeInTheDocument();
    expect(within(dialog).getByText("Vietcombank")).toBeInTheDocument();
    expect(within(dialog).getByText(adminText("payout_masked_account", { lastFour: "3456" }))).toBeInTheDocument();
    expect(within(dialog).getByText("DP00012 K7Q2M9XA")).toBeInTheDocument();
    expect(dialog.textContent).not.toContain("0071000123456");
    const qr = within(dialog).getByRole("img");
    expect(qr).toHaveAccessibleName(adminText("panel_qr_label", { amount: formatMoney(135216) ?? "", bank: "Vietcombank", account: adminText("payout_masked_account", { lastFour: "3456" }) }));
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(qrPath(PAYOUT_FIXTURES.qrPayload).d);
  });

  it("AC1: a bank that matches no single VietQR bank, or a netting-only payout, shows the reason and no QR", async () => {
    const user = userEvent.setup();
    await desk("/admin/payouts", () => json(200, preview({ qrPayload: null, qrMissing: "no_single_bank" })));
    await user.click(screen.getAllByRole("button", { name: /^Chuy/ })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(adminText("panel_no_qr_bank"))).toBeInTheDocument();
    expect(within(dialog).queryByRole("img")).toBeNull();
  });

  it("AC2: when another staff member holds the customer, the panel says who is paying and shows no preview", async () => {
    const user = userEvent.setup();
    await desk("/admin/payouts", () => json(200, { outcome: "taken", staffName: "minh" }), ADMIN);
    await user.click(screen.getAllByRole("button", { name: /^Chuy/ })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(adminText("panel_taken", { name: "minh" }))).toBeInTheDocument();
    expect(within(dialog).queryByRole("img")).toBeNull();
  });

  it("AC4: after an abandoned claim whose QR was shown, the panel opens with the 'may have transferred' warning", async () => {
    const user = userEvent.setup();
    await desk("/admin/payouts", () => json(200, preview({ warning: { amount: 79216, at: "2026-10-30T12:42:00.000Z" } })));
    await user.click(screen.getAllByRole("button", { name: /^Chuy/ })[0] as HTMLElement);
    const alert = await within(await screen.findByRole("dialog")).findByRole("alert");
    expect(alert).toHaveTextContent(adminText("panel_warning", { amount: formatMoney(79216) ?? "", time: "30/10 19:42" }));
  });

  it("AC5: on a phone the panel is a full-height drawer with a full-width QR and copy buttons; the preview and the list do not refetch while it is open", async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    const { server } = await desk();
    const before = listCalls(server).length;
    await user.click(screen.getAllByRole("button", { name: /^Chuy/ })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(PAYOUT_FIXTURES.holder);
    expect(dialog).toHaveAttribute("data-side", "bottom");
    expect(dialog.className).toContain("h-dvh");
    expect(dialog.querySelector("[data-panel=drawer]")).not.toBeNull();
    expect((dialog.querySelector("[data-qr-well]") as HTMLElement).style.maxWidth).toBe("");

    await user.click(within(dialog).getByRole("button", { name: adminText("panel_copy_amount") }));
    expect(await navigator.clipboard.readText()).toBe("135216");
    await user.click(within(dialog).getByRole("button", { name: adminText("panel_copy_reference") }));
    expect(await navigator.clipboard.readText()).toBe("DP00012 K7Q2M9XA");
    await user.click(within(dialog).getByRole("button", { name: adminText("panel_copy_account") }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("0071000123456"));
    expect(server.calls.filter((c) => c.path.endsWith("/account"))).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(claimCalls(server)).toHaveLength(1);
    expect(listCalls(server)).toHaveLength(before);
  });

  it("closing the panel releases the claim and refreshes the list", async () => {
    const user = userEvent.setup();
    const { server } = await desk();
    const before = listCalls(server).length;
    await user.click(screen.getAllByRole("button", { name: /^Chuy/ })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(PAYOUT_FIXTURES.holder);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(server.calls.filter((c) => c.path === "/api/admin/payout-claims/K7Q2M9XA/release")).toHaveLength(1));
    await waitFor(() => expect(listCalls(server).length).toBeGreaterThan(before));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Stories 4.6 and 4.7 code review on the desk", () => {
  it("review 11, superseded by Story 4.11: a netting-only row (0 d after clawbacks) sits in 'Can xu ly' with its badge and opens as 'Tru no', never as a transfer", async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole("tab", { name: new RegExp(adminText("payouts_tab_action")) }));
    await screen.findByText(adminText("flag_netting_only"));
    const netting = rowOf(PAYOUT_FIXTURES.names[3] ?? "");
    expect(within(netting).getByText(adminText("flag_netting_only"))).toBeInTheDocument();
    expect(within(netting).getByRole("button", { name: adminText("payout_open_netting_aria", { name: PAYOUT_FIXTURES.names[3] ?? "" }) })).toHaveTextContent(adminText("payout_open_netting"));
    expect(within(netting).queryByRole("button", { name: /^Chuy/ })).toBeNull();
  });

  it("review 3: closing the panel while the claim is still loading releases the claim when its answer arrives", async () => {
    const user = userEvent.setup();
    let answer: (a: ReturnType<typeof json>) => void = () => undefined;
    const late = new Promise<ReturnType<typeof json>>((resolve) => (answer = resolve));
    const { server } = await desk("/admin/payouts", () => late);
    await user.click(screen.getAllByRole("button", { name: /^Chuy/ })[0] as HTMLElement);
    await screen.findByRole("dialog");
    await waitFor(() => expect(claimCalls(server)).toHaveLength(1));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.calls.filter((c) => c.path.endsWith("/release"))).toHaveLength(0);
    await act(async () => answer(json(200, preview())));
    await waitFor(() => expect(server.calls.filter((c) => c.path === "/api/admin/payout-claims/K7Q2M9XA/release")).toHaveLength(1));
  });

  it("review 1 and 6: when the account changed under the claim, the copy is not counted as copied and the panel reloads its preview", async () => {
    const user = userEvent.setup();
    const { server } = await desk("/admin/payouts", undefined, EMPLOYEE, () => envelope(409, "conflict", "error.payout.account_changed"));
    await user.click(screen.getAllByRole("button", { name: /^Chuy/ })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(PAYOUT_FIXTURES.holder);
    await user.click(within(dialog).getByRole("button", { name: adminText("panel_copy_account") }));
    await waitFor(() => expect(claimCalls(server)).toHaveLength(2));
    expect(screen.queryByText(adminText("panel_copied"))).toBeNull();
  });
});

describe("review 6: the copy button writes to the clipboard inside the click (iOS Safari)", () => {
  it("calls clipboard.write with a ClipboardItem synchronously, before the value is fetched", async () => {
    const items: Record<string, Promise<Blob>>[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(content: Record<string, Promise<Blob>>) {
          items.push(content);
        }
      },
    );
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, writeText: vi.fn() } });
    let release: (v: string) => void = () => undefined;
    let asked = false;
    const value = () =>
      new Promise<string>((resolve) => {
        asked = true;
        release = resolve;
      });
    render(<CopyButton label="copy" value={value} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/ }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    await waitFor(() => expect(asked).toBe(true));
    release("0071000123456");
    const blob = await items[0]?.["text/plain"];
    expect(blob).toMatchObject({ type: "text/plain", size: "0071000123456".length });
    expect(await screen.findByText(adminText("panel_copied"))).toBeInTheDocument();
  });

  it("shows the failure, not 'copied', when the write is refused", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const onError = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    render(<CopyButton label="copy" value={() => "135216"} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/ }));
    expect(await screen.findByText(adminText("panel_copy_failed"))).toBeInTheDocument();
    expect(screen.queryByText(adminText("panel_copied"))).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
