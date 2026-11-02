/**
 * Story 7.2 (website side): the sign-in form at 360 px in the Zalo in-app browser, the answers
 * of the server shown where they belong, and the session a new password ended. The server side
 * (cookie, hash, delay, burst alert, Origin) is in apps/server/tests/customer-sign-in.test.ts.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { errorText, webText } from "../src/labels";
import { asZaloBrowser, envelope, fakeServer, json, LAN, renderSite } from "./app-harness";
import { setViewportWidth } from "./viewport";

const postSession = (answer: ReturnType<typeof json>) => (url: URL, init: RequestInit | undefined) => (url.pathname === "/api/session" && init?.method === "POST" ? answer : undefined);

async function fill(user: ReturnType<typeof userEvent.setup>, code: string, password: string): Promise<void> {
  if (code !== "") await user.type(await screen.findByLabelText(webText("sign_in_code")), code);
  if (password !== "") await user.type(screen.getByLabelText(webText("sign_in_password")), password);
  await user.click(screen.getByRole("button", { name: webText("sign_in_submit") }));
}

const describedBy = (element: HTMLElement): string[] => (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);

describe("Story 7.2 AC6: at 360 px in the Zalo in-app browser the labels show, paste works and errors are tied to their fields", () => {
  it("shows both labels and their hints, with the chat commands as copyable chips", async () => {
    setViewportWidth(360);
    asZaloBrowser();
    fakeServer();
    renderSite("/dang-nhap");
    const code = await screen.findByLabelText(webText("sign_in_code"));
    const password = screen.getByLabelText(webText("sign_in_password"));
    expect(screen.getByText(webText("sign_in_code"))).toBeVisible();
    expect(screen.getByText(webText("sign_in_password"))).toBeVisible();
    expect(describedBy(code)).toContain("customer-code-hint");
    expect(describedBy(password)).toContain("password-hint");
    for (const command of [webText("command_id"), webText("command_password")]) expect(screen.getByRole("button", { name: new RegExp(command) })).toBeInTheDocument();
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(code).toHaveAttribute("autocomplete", "username");
  });

  it("lets the password from /matkhau be pasted, and shows it on request", async () => {
    setViewportWidth(360);
    asZaloBrowser();
    fakeServer();
    const user = userEvent.setup();
    renderSite("/dang-nhap");
    const password = await screen.findByLabelText(webText("sign_in_password"));
    expect(password).toHaveAttribute("type", "password");
    await user.click(password);
    await user.paste("Kp7mWx3q");
    expect(password).toHaveValue("Kp7mWx3q");
    await user.click(screen.getByRole("button", { name: webText("sign_in_show_password") }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("says a missing or malformed field under that field, and sends nothing", async () => {
    setViewportWidth(360);
    const server = fakeServer();
    const user = userEvent.setup();
    renderSite("/dang-nhap");
    await fill(user, "12345", "");
    const code = screen.getByLabelText(webText("sign_in_code"));
    const password = screen.getByLabelText(webText("sign_in_password"));
    expect(document.getElementById("customer-code-error")).toHaveTextContent(errorText("error.customer_code_format", "invalid_request"));
    expect(describedBy(code)).toContain("customer-code-error");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("password-error")).toHaveTextContent(errorText("error.password_required", "invalid_request"));
    expect(describedBy(password)).toContain("password-error");
    expect(server.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("says only that the code or password is wrong on a refusal, tied to both fields, keeping what was typed", async () => {
    setViewportWidth(360);
    fakeServer({ routes: [postSession(envelope(401, "unauthorized", "error.customer_sign_in_refused"))] });
    const user = userEvent.setup();
    renderSite("/dang-nhap");
    await fill(user, "dp00012", "wrong-pass");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(errorText("error.customer_sign_in_refused", "unauthorized"));
    for (const label of ["sign_in_code", "sign_in_password"] as const) expect(describedBy(screen.getByLabelText(webText(label)))).toContain(alert.id);
    expect(screen.getByLabelText(webText("sign_in_password"))).toHaveValue("wrong-pass");
    expect(document.querySelector("[data-mascot]")).toHaveAttribute("data-mascot", "waiting");
  });

  it("names the Vietnam time a waiting code may try again (the throttled state)", async () => {
    fakeServer({ routes: [postSession(envelope(429, "rate_limited", "error.customer_sign_in_waiting", { retryAt: "2026-10-30T12:57:00.000Z" }))] });
    const user = userEvent.setup();
    renderSite("/dang-nhap");
    await fill(user, "DP00012", "wrong-pass");
    expect(await screen.findByRole("alert")).toHaveTextContent(errorText("error.customer_sign_in_waiting", "rate_limited", { time: "19:57" }));
  });

  it("sends the code as typed, trimmed, and opens My money after a successful sign-in", async () => {
    const server = fakeServer({ routes: [postSession(json(200, LAN))] });
    const user = userEvent.setup();
    const { history } = renderSite("/dang-nhap");
    await fill(user, " dp00012 ", "Kp7mWx3q");
    expect(server.requests.find((r) => r.method === "POST")?.body).toEqual({ customerCode: "dp00012", password: "Kp7mWx3q" });
    server.setSession(LAN);
    await screen.findByRole("heading", { level: 1, name: webText("my_money_title") });
    expect(history.location.pathname).toBe("/tien-cua-toi");
  });

  it("goes back to the page asked for, never to another site", async () => {
    const server = fakeServer({ routes: [postSession(json(200, LAN))] });
    const user = userEvent.setup();
    const { history } = renderSite("/dang-nhap?redirect=%2F%2Fevil.example%2F");
    await fill(user, "DP00012", "Kp7mWx3q");
    server.setSession(LAN);
    await waitFor(() => expect(history.location.pathname).toBe("/tien-cua-toi"));
  });
});

describe("Story 7.2 AC5: a session ended by a new password says so on any signed-in page, with the sign-in form", () => {
  it("shows the sentence and the form on My money, and opens the page after signing in again", async () => {
    const server = fakeServer({ session: envelope(401, "unauthorized", "error.session_ended_new_password"), routes: [postSession(json(200, LAN))] });
    const user = userEvent.setup();
    renderSite("/tien-cua-toi");
    const notice = await screen.findByText(errorText("error.session_ended_new_password", "unauthorized"));
    expect(notice).toHaveTextContent("Phi\u00EAn \u0111\u0103ng nh\u1EADp \u0111\u00E3 k\u1EBFt th\u00FAc v\u00EC c\u00F3 m\u1EADt kh\u1EA9u m\u1EDBi.");
    expect(screen.getByRole("heading", { level: 1, name: webText("sign_in_title") })).toBeInTheDocument();
    await fill(user, "DP00012", "Nw3pass8");
    server.setSession(LAN);
    await screen.findByRole("heading", { level: 1, name: webText("my_money_title") });
    expect(within(document.querySelector("main") as HTMLElement).getByRole("button", { name: new RegExp(LAN.customerCode) })).toBeInTheDocument();
  });

  it("shows the plain form, without that sentence, to a customer who is simply signed out", async () => {
    fakeServer();
    renderSite("/tien-cua-toi");
    await screen.findByRole("heading", { level: 1, name: webText("sign_in_title") });
    expect(screen.queryByText(errorText("error.session_ended_new_password", "unauthorized"))).toBeNull();
  });
});

describe("Story 7.2 review items 3, 4, 5 and 10", () => {
  it("review item 3: a network or server error on a signed-in page says so with a retry, never the sign-in form", async () => {
    const server = fakeServer({ session: envelope(503, "busy", "error.busy") });
    const user = userEvent.setup();
    renderSite("/tien-cua-toi");
    // The query retries a server error once (after about a second) before saying so.
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(webText("session_check_failed"));
    expect(screen.queryByLabelText(webText("sign_in_password"))).toBeNull();
    server.setSession(LAN);
    await user.click(screen.getByRole("button", { name: webText("retry") }));
    await screen.findByRole("heading", { level: 1, name: webText("my_money_title") });
  });

  it("review item 4: the new-password sentence stays on every page after the server said it once, until dismissed", async () => {
    const server = fakeServer({ session: envelope(401, "unauthorized", "error.session_ended_new_password") });
    const user = userEvent.setup();
    const { queryClient } = renderSite("/tien-cua-toi");
    const sentence = errorText("error.session_ended_new_password", "unauthorized");
    await screen.findByText(sentence);
    server.setSession(null);
    await queryClient.refetchQueries({ queryKey: ["customer", "session"] });
    await user.click(screen.getAllByRole("link", { name: webText("nav_guide") })[0] as HTMLElement);
    await screen.findByRole("heading", { level: 1, name: webText("guide_title") });
    expect(screen.getByText(sentence)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: webText("notice_dismiss") }));
    await waitFor(() => expect(screen.queryByText(sentence)).toBeNull());
  });

  it("review item 5: a refused Origin asks to reload the page instead of saying the action is not allowed", async () => {
    fakeServer({ routes: [postSession(envelope(403, "forbidden", "error.reload_page"))] });
    const user = userEvent.setup();
    renderSite("/dang-nhap");
    await fill(user, "DP00012", "Kp7mWx3q");
    expect(await screen.findByRole("alert")).toHaveTextContent(errorText("error.reload_page", "forbidden"));
    expect(errorText("error.reload_page", "forbidden")).not.toBe(errorText("error.forbidden", "forbidden"));
  });

  it("review item 10: signing out asks the server again and shows the signed-out top bar", async () => {
    const server = fakeServer({ session: LAN });
    const user = userEvent.setup();
    renderSite("/huong-dan");
    await user.click(await screen.findByRole("button", { name: webText("account_menu", { code: LAN.customerCode }) }));
    await user.click(await screen.findByRole("button", { name: webText("sign_out") }));
    expect(await screen.findByRole("link", { name: webText("sign_in_link") })).toBeInTheDocument();
    expect(server.requests.filter((r) => r.url.pathname === "/api/session" && r.method === "GET").length).toBeGreaterThan(1);
  });
});
