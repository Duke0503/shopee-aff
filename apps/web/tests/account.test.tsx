/**
 * Story 7.5 (website side): Account manages the bank account and the password. The form sends a
 * bank picked from the VietQR list, the number without spaces and dashes and the holder in upper
 * case, only with the consent box; a saved website change shows "waiting for your confirmation on
 * Zalo" with the confirm command; erase asks once; a password of 7 characters or equal to the code
 * is refused under its field. The server side (hold, Payouts row, confirmation, audit, messages)
 * is in apps/server/tests/website-account.test.ts.
 */
import { BANK_LIST_PATH, MY_BANK_ACCOUNT_PATH, MY_MONEY_PATH, MY_PASSWORD_PATH, type MyMoney } from "@cashback/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { errorText, webText } from "../src/labels";
import { envelope, fakeServer, json, LAN, renderSite, type Answer, type Route } from "./app-harness";
import fixture from "./fixtures/my-money.json";
import { setViewportWidth } from "./viewport";

const SAVED = fixture.moneyNoDeduction as MyMoney;
const NO_BANK: MyMoney = { ...SAVED, bank: null };
const HELD: MyMoney = { ...SAVED, bank: { bankName: "Vietcombank", holderName: "NGUYEN THI LAN", lastFour: "6789", held: true } };
const BANKS = { banks: [ { bin: "970436", shortName: "Vietcombank", name: "Ng\u00e2n h\u00e0ng TMCP Ngo\u1ea1i Th\u01b0\u01a1ng Vi\u1ec7t Nam" }, { bin: "970422", shortName: "MB", name: "Ng\u00e2n h\u00e0ng TMCP Qu\u00e2n \u0111\u1ed9i" }, { bin: "970407", shortName: "Techcombank", name: "Ng\u00e2n h\u00e0ng TMCP K\u1ef9 th\u01b0\u01a1ng Vi\u1ec7t Nam" } ] };

interface Answers {
  money?: () => MyMoney;
  save?: (body: unknown) => Answer;
  erase?: () => Answer;
  password?: (body: unknown) => Answer;
}

function server(answers: Answers = {}) {
  const route: Route = (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    if (url.pathname === MY_MONEY_PATH) return json(200, (answers.money ?? (() => SAVED))());
    if (url.pathname === BANK_LIST_PATH) return json(200, BANKS);
    if (url.pathname === MY_BANK_ACCOUNT_PATH && method === "POST") return answers.save?.(body) ?? json(200, { result: "changed", bank: HELD.bank });
    if (url.pathname === MY_BANK_ACCOUNT_PATH && method === "DELETE") return answers.erase?.() ?? json(200, { erased: true });
    if (url.pathname === MY_PASSWORD_PATH) return answers.password?.(body) ?? json(200, { changed: true, otherSessionsEnded: 1 });
    return undefined;
  };
  return fakeServer({ session: LAN, routes: [route] });
}

async function fillBankForm(user: ReturnType<typeof userEvent.setup>, consent = true) {
  await user.click(await screen.findByRole("button", { name: new RegExp(webText("bank_pick")) }));
  await user.type(await screen.findByRole("searchbox", { name: webText("bank_search") }), "vietcom");
  await user.click(await screen.findByRole("button", { name: /Vietcombank/ }));
  await user.type(screen.getByLabelText(webText("bank_field_number")), "0071 0012-3456 789");
  await user.type(screen.getByLabelText(webText("bank_field_holder")), "nguyen thi lan");
  if (consent) await user.click(screen.getByLabelText(webText("bank_consent")));
}

const posts = (site: ReturnType<typeof server>, path: string, method = "POST") => site.requests.filter((r) => r.url.pathname === path && r.method === method);

describe("Story 7.5: Account page manages the bank account and password", () => {
  it("AC1: a bank change saved on the website shows 'waiting for your confirmation on Zalo' and the saved last four digits", async () => {
    let money = NO_BANK;
    const site = server({ money: () => money, save: () => ((money = HELD), json(200, { result: "saved", bank: HELD.bank })) });
    const user = userEvent.setup();
    renderSite("/tai-khoan");
    await screen.findByRole("heading", { level: 2, name: webText("account_bank_add_title") }, { timeout: 5000 });
    await fillBankForm(user);
    await user.click(screen.getByRole("button", { name: webText("bank_save") }));
    await screen.findByText(webText("account_bank_saved", { lastFour: "6789" }));
    expect(posts(site, MY_BANK_ACCOUNT_PATH)[0]?.body).toEqual({ bankBin: "970436", accountNumber: "007100123456789", holderName: "NGUYEN THI LAN", consent: true });
    const held = await waitFor(() => {
      const box = document.querySelector<HTMLElement>("[data-bank-held]");
      if (box === null) throw new Error("not held yet");
      return box;
    });
    expect(held).toHaveTextContent(webText("bank_held"));
  });

  it("AC2: while held, the account says how to confirm in the Zalo private chat: the exact command with the last four digits as a copy chip, and the Zalo button", async () => {
    server({ money: () => HELD });
    renderSite("/tai-khoan");
    const box = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-bank-held]");
      if (found === null) throw new Error("not rendered");
      return found;
    });
    expect(within(box).getByRole("button", { name: new RegExp(webText("command_bank_confirm", { lastFour: "6789" })) })).toBeInTheDocument();
    expect(webText("command_bank_confirm", { lastFour: "6789" })).toBe("/stk xacnhan 6789");
    expect(box.querySelector("[data-zalo-button]")).not.toBeNull();
  });

  it("AC2: once confirmed (held is false) the account shows without the waiting box", async () => {
    server({ money: () => SAVED });
    renderSite("/tai-khoan");
    await waitFor(() => expect(document.querySelector("[data-bank='saved']")).not.toBeNull());
    expect(document.querySelector("[data-bank-held]")).toBeNull();
  });

  it("AC3: a password of 7 characters is refused under the field before anything is sent; one equal to the code is refused by the server under the field", async () => {
    const site = server({ password: () => envelope(400, "invalid_request", "error.password.is_code", { newPassword: "error.password.is_code" }) });
    const user = userEvent.setup();
    renderSite("/tai-khoan");
    await user.click(await screen.findByRole("button", { name: webText("password_open") }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(webText("password_current")), "matkhau-cu-1");
    const next = screen.getByLabelText(webText("password_new"));
    await user.type(next, "1234567");
    await user.click(screen.getByRole("button", { name: webText("password_submit") }));
    expect(await screen.findByText(errorText("error.password.too_short", "invalid_request"))).toBeInTheDocument();
    expect(next).toHaveAttribute("aria-invalid", "true");
    expect(posts(site, MY_PASSWORD_PATH)).toHaveLength(0);
    await user.clear(next);
    await user.type(next, "dp000123");
    await user.click(screen.getByRole("button", { name: webText("password_submit") }));
    expect(await screen.findByText(errorText("error.password.is_code", "invalid_request"))).toBeInTheDocument();
    expect(posts(site, MY_PASSWORD_PATH)).toHaveLength(1);
  });

  it("AC3: a good password is saved and the page says other phones must sign in again", async () => {
    const site = server();
    const user = userEvent.setup();
    renderSite("/tai-khoan");
    await user.click(await screen.findByRole("button", { name: webText("password_open") }, { timeout: 5000 }));
    await user.type(screen.getByLabelText(webText("password_current")), "matkhau-cu-1");
    await user.type(screen.getByLabelText(webText("password_new")), "matkhau-moi-2");
    await user.click(screen.getByRole("button", { name: webText("password_submit") }));
    expect(await screen.findByText(webText("password_changed"))).toBeInTheDocument();
    expect(posts(site, MY_PASSWORD_PATH)[0]?.body).toEqual({ currentPassword: "matkhau-cu-1", newPassword: "matkhau-moi-2" });
  });

  it("AC4: erase asks once, then removes the account", async () => {
    let money = SAVED;
    const site = server({ money: () => money, erase: () => ((money = NO_BANK), json(200, { erased: true })) });
    const user = userEvent.setup();
    renderSite("/tai-khoan");
    await user.click(await screen.findByRole("button", { name: webText("account_bank_erase") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(webText("bank_erase_title", { bank: "Vietcombank", lastFour: "6789" }));
    await user.click(within(dialog).getByRole("button", { name: webText("bank_erase_confirm") }));
    expect(await screen.findByText(webText("account_bank_erased"))).toBeInTheDocument();
    expect(posts(site, MY_BANK_ACCOUNT_PATH, "DELETE")).toHaveLength(1);
    await screen.findByRole("heading", { level: 2, name: webText("account_bank_add_title") }, { timeout: 5000 });
  });

  it("AC5: with the consent box unchecked the form is refused under the box and nothing is sent", async () => {
    const site = server({ money: () => NO_BANK });
    const user = userEvent.setup();
    renderSite("/tai-khoan");
    await screen.findByRole("heading", { level: 2, name: webText("account_bank_add_title") }, { timeout: 5000 });
    await fillBankForm(user, false);
    await user.click(screen.getByRole("button", { name: webText("bank_save") }));
    expect(await screen.findByText(errorText("error.bank.consent_required", "invalid_request"))).toBeInTheDocument();
    expect(screen.getByLabelText(webText("bank_consent"))).toHaveAttribute("aria-invalid", "true");
    expect(posts(site, MY_BANK_ACCOUNT_PATH)).toHaveLength(0);
  });

  it("AC5: on phone the bank picker is a drawer from the bottom; on desktop a side sheet", async () => {
    setViewportWidth(390);
    server({ money: () => NO_BANK });
    const user = userEvent.setup();
    renderSite("/tai-khoan");
    await user.click(await screen.findByRole("button", { name: new RegExp(webText("bank_pick")) }));
    await waitFor(() => expect(document.querySelector("[data-bank-picker]")).toHaveAttribute("data-bank-picker", "drawer"));
    await user.keyboard("{Escape}");
    setViewportWidth(1440);
    await user.click(await screen.findByRole("button", { name: new RegExp(webText("bank_pick")) }));
    await waitFor(() => expect(document.querySelector("[data-bank-picker]")).toHaveAttribute("data-bank-picker", "sheet"));
  });

  it("each broken rule the server names is said under its own field", async () => {
    server({ money: () => NO_BANK, save: () => envelope(400, "invalid_request", "error.bank.number_rule", { accountNumber: "error.bank.number_rule", holderName: "error.bank.holder_rule" }) });
    const user = userEvent.setup();
    renderSite("/tai-khoan");
    await screen.findByRole("heading", { level: 2, name: webText("account_bank_add_title") }, { timeout: 5000 });
    await fillBankForm(user);
    await user.click(screen.getByRole("button", { name: webText("bank_save") }));
    expect(await screen.findByText(errorText("error.bank.number_rule", "invalid_request"))).toBeInTheDocument();
    expect(screen.getByText(errorText("error.bank.holder_rule", "invalid_request"))).toBeInTheDocument();
    expect(screen.getByLabelText(webText("bank_field_number"))).toHaveAttribute("aria-invalid", "true");
  });
});
