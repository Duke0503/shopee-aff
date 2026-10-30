import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { adminText, errorText } from "../src/labels";
import { EMPLOYEE, envelope, fakeServer, json, renderDesk } from "./app-harness";

async function fill(user: ReturnType<typeof userEvent.setup>, username: string, password: string): Promise<void> {
  await user.type(await screen.findByLabelText(adminText("sign_in_username")), username);
  await user.type(screen.getByLabelText(adminText("sign_in_password")), password);
  await user.click(screen.getByRole("button", { name: adminText("sign_in_submit") }));
}

const postSession = (answer: ReturnType<typeof json>) => (url: URL, init: RequestInit | undefined) => (url.pathname === "/api/admin/session" && init?.method === "POST" ? answer : undefined);

describe("Story 4.4 admin sign-in form (deferred from Story 4.2)", () => {
  it("says only that the name or password is wrong on a refused sign-in, tied to the fields", async () => {
    fakeServer({ session: null, routes: [postSession(envelope(401, "unauthorized", "error.staff_sign_in_refused"))] });
    const user = userEvent.setup();
    renderDesk("/admin/sign-in");
    await fill(user, "tu", "wrong");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(errorText("error.staff_sign_in_refused", "unauthorized"));
    expect(screen.getByLabelText(adminText("sign_in_password"))).toHaveAttribute("aria-describedby", alert.id);
    expect(screen.getByLabelText(adminText("sign_in_password"))).toHaveValue("wrong");
  });

  it("names the Vietnam time a waiting name may try again", async () => {
    fakeServer({ session: null, routes: [postSession(envelope(429, "rate_limited", "error.staff_sign_in_waiting", { retryAt: "2026-10-30T12:57:00.000Z" }))] });
    const user = userEvent.setup();
    renderDesk("/admin/sign-in");
    await fill(user, "tu", "wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent(errorText("error.staff_sign_in_waiting", "rate_limited", { time: "19:57" }));
  });

  it("asks for both fields before sending anything", async () => {
    const server = fakeServer({ session: null });
    const user = userEvent.setup();
    renderDesk("/admin/sign-in");
    await user.click(await screen.findByRole("button", { name: adminText("sign_in_submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(adminText("sign_in_required"));
    expect(server.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("shows the password on request and lets paste through", async () => {
    fakeServer({ session: null });
    const user = userEvent.setup();
    renderDesk("/admin/sign-in");
    const password = await screen.findByLabelText(adminText("sign_in_password"));
    expect(password).toHaveAttribute("type", "password");
    await user.click(password);
    await user.paste("pasted-secret");
    expect(password).toHaveValue("pasted-secret");
    await user.click(screen.getByRole("button", { name: adminText("sign_in_show_password") }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: adminText("sign_in_hide_password") })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the Overview after a successful sign-in", async () => {
    const server = fakeServer({ session: null, routes: [postSession(json(200, EMPLOYEE))] });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/sign-in");
    await fill(user, "tu", "secret-pass");
    server.setSession(EMPLOYEE);
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    expect(history.location.pathname).toBe("/admin/");
  });

  it("signs out and returns to the sign-in form", async () => {
    fakeServer({ session: EMPLOYEE });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/");
    await user.click(await screen.findByRole("button", { name: adminText("sign_out") }));
    await screen.findByRole("heading", { level: 1, name: adminText("sign_in_title") });
    expect(history.location.pathname).toBe("/admin/sign-in");
  });

  it("refuses a redirect to another site after sign-in", async () => {
    const server = fakeServer({ session: null, routes: [postSession(json(200, EMPLOYEE))] });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/sign-in?redirect=//evil.example");
    await fill(user, "tu", "secret-pass");
    server.setSession(EMPLOYEE);
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    expect(history.location.pathname).toBe("/admin/");
  });
});
