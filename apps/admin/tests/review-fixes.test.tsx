import { statusLabel, uiText } from "@cashback/ui";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { adminText } from "../src/labels";
import { parseSearch } from "../src/search-params";
import { SESSION_KEY } from "../src/session/session.queries";
import { EMPLOYEE, envelope, fakeServer, json, orderRow, ordersAnswer, renderDesk, type Route } from "./app-harness";

const ordersOk: Route = (url) => (url.pathname === "/api/admin/orders" ? ordersAnswer([orderRow(1)]) : undefined);
const heading = (key: Parameters<typeof adminText>[0]) => screen.findByRole("heading", { level: 1, name: adminText(key) });
const chip = (labelKey: string) => screen.getByRole("button", { name: new RegExp(`^${statusLabel(labelKey)} \\d`) });

async function signIn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText(adminText("sign_in_username")), "tu");
  await user.type(screen.getByLabelText(adminText("sign_in_password")), "secret-pass");
  await user.click(screen.getByRole("button", { name: adminText("sign_in_submit") }));
}

describe("review item 1: a failed background session check keeps the desk while a session is cached", () => {
  it("stays on the page after a 5xx re-check instead of showing the session error screen", async () => {
    let failing = false;
    fakeServer({ session: EMPLOYEE, routes: [(url, init) => (failing && url.pathname === "/api/admin/session" && (init?.method ?? "GET") === "GET" ? envelope(503, "busy", "error.busy") : undefined)] });
    const { queryClient } = renderDesk("/admin/payouts");
    await heading("nav_payouts");
    failing = true;
    await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    await waitFor(() => expect(queryClient.getQueryState(SESSION_KEY)?.status).toBe("error"), { timeout: 5000 });
    expect(screen.getByRole("heading", { level: 1, name: adminText("nav_payouts") })).toBeInTheDocument();
    expect(screen.queryByText(adminText("session_error"))).toBeNull();
  });
});

describe("review item 2: a session that expires mid-use returns to the page the staff member was on", () => {
  it("redirects with the current page, not the first one, and comes back there after sign-in", async () => {
    const server = fakeServer({ session: EMPLOYEE, routes: [ordersOk] });
    const user = userEvent.setup();
    const { history, queryClient } = renderDesk("/admin/orders");
    await heading("nav_orders");
    await user.click(screen.getByRole("link", { name: adminText("nav_payouts") }));
    await heading("nav_payouts");
    server.setSession(null);
    await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    await heading("sign_in_title");
    expect(parseSearch(history.location.search)["redirect"]).toBe("/payouts");
    server.setSession(EMPLOYEE);
    await signIn(user);
    await heading("nav_payouts");
    expect(history.location.pathname).toBe("/admin/payouts");
  });
});

describe("review item 5: a successful sign-in navigates once", () => {
  it("moves on with a single history change", async () => {
    const server = fakeServer({ session: null, routes: [(url, init) => (url.pathname === "/api/admin/session" && init?.method === "POST" ? json(200, EMPLOYEE) : undefined)] });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/sign-in");
    await screen.findByLabelText(adminText("sign_in_username"));
    const push = vi.spyOn(history, "push");
    const replace = vi.spyOn(history, "replace");
    server.setSession(EMPLOYEE);
    await signIn(user);
    await heading("nav_overview");
    expect(push.mock.calls.length + replace.mock.calls.length).toBe(1);
  });
});

describe("review item 6: sign-out leaves the desk first and reports a failure instead of pretending", () => {
  it("lands on the sign-in form without a redirect back into the desk", async () => {
    const server = fakeServer({ session: EMPLOYEE });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/payouts");
    await user.click(await screen.findByRole("button", { name: adminText("sign_out") }));
    await heading("sign_in_title");
    await waitFor(() => expect(history.location.pathname).toBe("/admin/sign-in"));
    expect(parseSearch(history.location.search)["redirect"]).toBeUndefined();
    expect(server.requests.some((r) => r.method === "DELETE")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(history.location.pathname).toBe("/admin/sign-in");
  });

  it("keeps the desk and says sign-out failed when the server does not confirm it", async () => {
    fakeServer({ session: EMPLOYEE, routes: [(url, init) => (url.pathname === "/api/admin/session" && init?.method === "DELETE" ? envelope(500, "internal", "error.internal") : undefined)] });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/payouts");
    await user.click(await screen.findByRole("button", { name: adminText("sign_out") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(adminText("sign_out_failed"));
    expect(screen.getByRole("heading", { level: 1, name: adminText("nav_payouts") })).toBeInTheDocument();
    expect(history.location.pathname).toBe("/admin/payouts");
  });
});

describe("review item 7: repeated filter keys in a URL are one filter with every value", () => {
  it("joins repeated filter keys and keeps the last value of any other key", () => {
    expect(parseSearch("?filter[status]=APPROVED&filter[status]=PAID&q=a&q=b")).toEqual({ "filter[status]": "APPROVED,PAID", q: "b" });
  });

  it("presses both chips for a link that repeats the key", async () => {
    const server = fakeServer({ session: EMPLOYEE, routes: [ordersOk] });
    const { history } = renderDesk("/admin/orders?filter[status]=APPROVED&filter[status]=PAID");
    await heading("nav_orders");
    await waitFor(() => expect(chip("status_paid")).toHaveAttribute("aria-pressed", "true"));
    expect(chip("status_approved")).toHaveAttribute("aria-pressed", "true");
    expect(history.location.search).toBe("?filter[status]=APPROVED,PAID");
    expect(server.requests.find((r) => r.url.pathname === "/api/admin/orders")?.url.searchParams.get("filter[status]")).toBe("APPROVED,PAID");
  });
});

describe("review item 4: a stale filter value never sticks the list in an error", () => {
  it("drops an unknown status from the URL and the request", async () => {
    const server = fakeServer({ session: EMPLOYEE, routes: [ordersOk] });
    const { history } = renderDesk("/admin/orders?filter[status]=APPROVED,SHIPPED");
    await heading("nav_orders");
    await waitFor(() => expect(history.location.search).toBe("?filter[status]=APPROVED"));
    const sent = server.requests.filter((r) => r.url.pathname === "/api/admin/orders").map((r) => r.url.searchParams.get("filter[status]"));
    expect(sent).toEqual(["APPROVED"]);
  });

  it("offers clear filters on the error state while filters are on", async () => {
    fakeServer({ session: EMPLOYEE, routes: [(url) => (url.pathname === "/api/admin/orders" ? (url.searchParams.has("filter[status]") ? envelope(400, "invalid_request", "error.invalid_request") : ordersAnswer([orderRow(1)])) : undefined)] });
    const user = userEvent.setup();
    const { history } = renderDesk("/admin/orders?filter[status]=PAID");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(uiText("list_error_title"));
    await user.click(screen.getByRole("button", { name: uiText("list_clear_filters") }));
    await waitFor(() => expect(history.location.search).toBe(""));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("review item 11: order rows carry the product snapshot image to the list", () => {
  it("shows the row's image next to the product name and a placeholder for a row without one", async () => {
    fakeServer({ session: EMPLOYEE, routes: [(url) => (url.pathname === "/api/admin/orders" ? ordersAnswer([orderRow(2), orderRow(3)]) : undefined)] });
    const { container } = renderDesk("/admin/orders");
    await heading("nav_orders");
    await waitFor(() => expect(container.querySelector("img[data-thumb=image]")).toHaveAttribute("src", "https://cf.example.test/file/p2.jpg"));
    expect(container.querySelectorAll("[data-thumb=placeholder]")).toHaveLength(1);
  });

  it("refuses a row whose image is not an https URL", async () => {
    fakeServer({ session: EMPLOYEE, routes: [(url) => (url.pathname === "/api/admin/orders" ? ordersAnswer([orderRow(2, { productImageUrl: "javascript:alert(1)" })]) : undefined)] });
    renderDesk("/admin/orders");
    expect(await screen.findByRole("alert")).toHaveTextContent(uiText("list_error_title"));
  });
});
