import { statusLabel } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import adminLabels from "@cashback/labels/vi/admin.json";

import { adminText } from "../src/labels";
import { NAV_ITEMS } from "../src/shell/nav-items";
import { ADMIN, EMPLOYEE, fakeServer, renderDesk } from "./app-harness";
import { setViewportWidth } from "./viewport";

const nav = () => screen.getByRole("navigation", { name: adminText("nav_label") });

describe("Story 4.4 AC1: desktop sidebar shows the three groups; Staff and Campaigns only for an admin", () => {
  it("shows an employee the three groups without Staff and Campaigns", async () => {
    fakeServer({ session: EMPLOYEE });
    renderDesk("/admin/");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    const sidebar = nav();
    for (const key of ["nav_group_daily", "nav_group_customers", "nav_group_admin"] as const) expect(within(sidebar).getByRole("heading", { name: adminText(key) })).toBeInTheDocument();
    for (const key of ["nav_overview", "nav_payouts", "nav_review", "nav_orders", "nav_customers", "nav_links", "nav_audit", "nav_settings"] as const) expect(within(sidebar).getByRole("link", { name: adminText(key) })).toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: adminText("nav_staff") })).toBeNull();
    expect(within(sidebar).queryByRole("link", { name: adminText("nav_campaigns") })).toBeNull();
    expect(document.querySelector("[data-layout=desktop]")).not.toBeNull();
  });

  it("shows an admin Staff and Campaigns as well", async () => {
    fakeServer({ session: ADMIN });
    renderDesk("/admin/");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    expect(within(nav()).getByRole("link", { name: adminText("nav_staff") })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: adminText("nav_campaigns") })).toBeInTheDocument();
    expect(within(nav()).getAllByRole("link")).toHaveLength(NAV_ITEMS.length);
  });

  it("marks the current page and shows who is signed in with sign-out", async () => {
    fakeServer({ session: EMPLOYEE });
    renderDesk("/admin/payouts");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_payouts") });
    expect(within(nav()).getByRole("link", { name: adminText("nav_payouts") })).toHaveAttribute("data-status", "active");
    expect(within(nav()).getByRole("link", { name: adminText("nav_overview") })).not.toHaveAttribute("data-status", "active");
    expect(screen.getByText(EMPLOYEE.username)).toBeInTheDocument();
    expect(screen.getByText(adminText("role_employee"))).toBeInTheDocument();
  });
});

describe("Story 4.4 AC2: phone at 390 px has the bottom tab bar with 44 px targets and safe-area padding", () => {
  it("shows the four tabs and More, each at least 44 px, on a bar padded by the safe area", async () => {
    setViewportWidth(390);
    fakeServer({ session: EMPLOYEE });
    renderDesk("/admin/");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    const bar = nav();
    expect(bar).toHaveClass("fixed", "bottom-0", "pb-[env(safe-area-inset-bottom)]");
    const names = within(bar)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(names).toEqual([adminText("tab_overview"), adminText("tab_payouts"), adminText("tab_orders"), adminText("tab_customers"), adminText("tab_more")]);
    for (const target of [...within(bar).getAllByRole("link"), within(bar).getByRole("button", { name: adminText("tab_more") })]) {
      expect(target).toHaveClass("h-14", "min-h-11", "min-w-11");
    }
    expect(document.querySelector("[data-layout=phone]")).not.toBeNull();
  });

  it("opens More as a bottom sheet with the other pages this role may open and sign-out", async () => {
    setViewportWidth(390);
    fakeServer({ session: EMPLOYEE });
    const user = userEvent.setup();
    renderDesk("/admin/");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    await user.click(screen.getByRole("button", { name: adminText("tab_more") }));
    const sheet = await screen.findByRole("dialog", { name: adminText("more_title") });
    for (const key of ["nav_review", "nav_links", "nav_audit", "nav_settings"] as const) expect(within(sheet).getByRole("link", { name: adminText(key) })).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: adminText("nav_staff") })).toBeNull();
    expect(within(sheet).getByRole("button", { name: adminText("sign_out") })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("link", { name: adminText("nav_review") }));
    await screen.findByRole("heading", { level: 1, name: adminText("nav_review") });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Story 4.4 AC3: tablet at 820 px uses an icon rail with tooltips and visible focus", () => {
  it("renders 44 px icon links named by their page, with a focus ring", async () => {
    setViewportWidth(820);
    fakeServer({ session: EMPLOYEE });
    renderDesk("/admin/");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    expect(document.querySelector("[data-layout=tablet]")).not.toBeNull();
    const links = within(nav()).getAllByRole("link");
    expect(links).toHaveLength(NAV_ITEMS.length - 2);
    for (const link of links) {
      expect(link).toHaveClass("size-11", "focus-visible:ring-3");
      expect(link.textContent).toBe("");
    }
  });

  it("shows the page name as a tooltip when an icon gets keyboard focus", async () => {
    setViewportWidth(820);
    fakeServer({ session: EMPLOYEE });
    const user = userEvent.setup();
    renderDesk("/admin/");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_overview") });
    await user.tab();
    await user.tab();
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("aria-label")).toBe(adminText("nav_overview"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(adminText("nav_overview"));
  });
});

describe("Story 4.4 AC4: an employee opening an admin-only URL sees the admin-only line", () => {
  it.each([["/admin/staff"], ["/admin/campaigns"]])("shows the label for %s", async (path) => {
    fakeServer({ session: EMPLOYEE });
    renderDesk(path);
    expect(await screen.findByRole("alert")).toHaveTextContent(adminText("admin_only"));
    expect(adminText("admin_only")).toBe(adminLabels.admin_only);
  });

  it("shows an admin the page itself", async () => {
    fakeServer({ session: ADMIN });
    renderDesk("/admin/staff");
    await screen.findByRole("heading", { level: 1, name: adminText("nav_staff") });
    expect(screen.queryByText(adminText("admin_only"))).toBeNull();
  });
});

describe("Shell routing: sign-in redirect, not found", () => {
  it("sends a visitor without a session to sign-in and back to the page asked for", async () => {
    const server = fakeServer({ session: null });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/orders?filter[status]=PAID");
    await screen.findByRole("heading", { level: 1, name: adminText("sign_in_title") });
    expect(history.location.pathname).toBe("/admin/sign-in");
    server.setSession(EMPLOYEE);
    await user.type(screen.getByLabelText(adminText("sign_in_username")), "tu");
    await user.type(screen.getByLabelText(adminText("sign_in_password")), "secret-pass");
    await user.click(screen.getByRole("button", { name: adminText("sign_in_submit") }));
    await screen.findByRole("heading", { level: 1, name: adminText("nav_orders") });
    expect(history.location.pathname).toBe("/admin/orders");
    expect(history.location.search).toBe("?filter[status]=PAID");
    expect(screen.getByRole("button", { name: new RegExp(`^${statusLabel("status_paid")}`) })).toHaveAttribute("aria-pressed", "true");
    const signIn = server.requests.find((r) => r.method === "POST");
    expect(signIn?.body).toEqual({ username: "tu", password: "secret-pass" });
  });

  it("shows the not-found page with the way back to the Overview", async () => {
    fakeServer({ session: EMPLOYEE });
    renderDesk("/admin/no-such-page");
    expect(await screen.findByRole("heading", { name: adminText("not_found_title") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: adminText("not_found_action") })).toHaveAttribute("href", "/admin/");
  });
});
