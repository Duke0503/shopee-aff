/**
 * Story 7.1: the customer website shell. The banner follows the server's site status page by
 * page; the phone tabs, their targets and the keyboard rule are checked at 360 px with the Zalo
 * in-app browser's user agent. Sideways scrolling and real target sizes in a browser are checked
 * by scripts/take-screenshots.mjs at 360, 390, 768 and 1440 px.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { uiText } from "@cashback/ui";

import { webText } from "../src/labels";
import { NAV_ITEMS } from "../src/shell/nav-items";
import { ASSISTANT_CHAT, asZaloBrowser, DOWN, FALLBACK, fakeServer, LAN, renderSite, UP } from "./app-harness";
import { setViewportWidth } from "./viewport";

const HOME_TITLE = webText("home_title");
const banner = () => screen.queryByRole("region", { name: webText("zalo_down_title") });
const tabs = () => document.querySelector<HTMLElement>("[data-bottom-tabs]");

describe("Story 7.1 AC1: with the assistant reported down, every page shows the banner with the fallback contact path", () => {
  it("shows the banner on Home, Guide and Sign in with the fallback link and no way to close it", async () => {
    fakeServer({ status: DOWN });
    const user = userEvent.setup();
    renderSite("/");
    for (const name of [webText("nav_guide"), webText("sign_in_link")]) {
      const region = await waitFor(() => {
        const found = banner();
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      expect(within(region).getByText(webText("zalo_down_body"))).toBeInTheDocument();
      expect(within(region).getByRole("link", { name: webText("zalo_down_contact") })).toHaveAttribute("href", FALLBACK);
      expect(within(region).queryByRole("button")).toBeNull();
      await user.click(screen.getAllByRole("link", { name })[0] as HTMLElement);
    }
    expect(banner()).not.toBeNull();
  });

  it("points the Zalo button to the fallback contact and says so", async () => {
    fakeServer({ status: DOWN });
    renderSite("/");
    const button = await waitFor(() => {
      const found = document.querySelector<HTMLAnchorElement>("[data-zalo-button]");
      expect(found?.dataset["zaloButton"]).toBe("fallback");
      return found as HTMLAnchorElement;
    });
    expect(button).toHaveAttribute("href", FALLBACK);
    expect(button).toHaveTextContent(webText("zalo_down_button"));
  });

  it("with no fallback set, keeps the banner and hides the Zalo button instead of sending people to a dead chat", async () => {
    fakeServer({ status: { assistant: "down", fallbackContactUrl: null, assistantUrl: null } });
    renderSite("/");
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(within(banner() as HTMLElement).queryByRole("link")).toBeNull();
    expect(document.querySelector("[data-zalo-button]")).toBeNull();
  });

  it("while the assistant is up, the Zalo button opens the assistant's private chat from ZALO_ASSISTANT_URL", async () => {
    fakeServer({ status: { ...UP, assistantUrl: ASSISTANT_CHAT } });
    renderSite("/");
    await waitFor(() => expect(document.querySelector("[data-zalo-button]")).toHaveAttribute("href", ASSISTANT_CHAT));
  });

  it("while the assistant is up and ZALO_ASSISTANT_URL is unset, the Zalo button opens the community group", async () => {
    fakeServer({ status: UP });
    renderSite("/");
    const button = await waitFor(() => {
      const found = document.querySelector<HTMLAnchorElement>("[data-zalo-button]");
      expect(found).not.toBeNull();
      return found as HTMLAnchorElement;
    });
    expect(button).toHaveAttribute("href", webText("zalo_url"));
    expect(button).toHaveTextContent(webText("zalo_panel_button"));
  });
});

describe("Story 7.1 AC2: once the assistant is back, the next page load has no banner", () => {
  it("drops the banner on the next page the customer opens", async () => {
    const server = fakeServer({ status: DOWN });
    const user = userEvent.setup();
    renderSite("/");
    await waitFor(() => expect(banner()).not.toBeNull());
    server.setStatus(UP);
    await user.click(screen.getAllByRole("link", { name: webText("nav_guide") })[0] as HTMLElement);
    await screen.findByRole("heading", { level: 1, name: webText("guide_title") });
    await waitFor(() => expect(banner()).toBeNull());
    expect(document.querySelector<HTMLAnchorElement>("[data-zalo-button]")).toBeNull();
  });

  it("asks the server again on every page change", async () => {
    const server = fakeServer({ status: UP });
    const user = userEvent.setup();
    renderSite("/");
    await screen.findByRole("heading", { level: 1, name: HOME_TITLE });
    const before = server.requests.filter((r) => r.url.pathname === "/api/site-status").length;
    await user.click(screen.getAllByRole("link", { name: webText("nav_guide") })[0] as HTMLElement);
    await waitFor(() => expect(server.requests.filter((r) => r.url.pathname === "/api/site-status").length).toBeGreaterThan(before));
  });
});

describe("Story 7.1 AC4: at 360 px in the Zalo in-app browser, each tab opens, targets are 44 px and the bar hides with the keyboard", () => {
  it("opens each of the three tabs from the bottom bar, the current one marked", async () => {
    setViewportWidth(360);
    asZaloBrowser();
    fakeServer({ session: LAN });
    const user = userEvent.setup();
    renderSite("/");
    await screen.findByRole("heading", { level: 1, name: HOME_TITLE });
    const bar = tabs() as HTMLElement;
    expect(bar).toHaveClass("fixed", "bottom-0", "pb-[env(safe-area-inset-bottom)]", "md:hidden");
    expect(within(bar).getAllByRole("listitem").map((li) => li.textContent)).toEqual(NAV_ITEMS.map((item) => webText(item.labelKey)));
    const titles: Record<string, string> = { nav_home: HOME_TITLE, nav_my_money: webText("my_money_title"), nav_guide: webText("guide_title") };
    for (const item of NAV_ITEMS) {
      await user.click(within(tabs() as HTMLElement).getByRole("link", { name: webText(item.labelKey) }));
      await screen.findByRole("heading", { level: 1, name: titles[item.labelKey] });
      expect(within(tabs() as HTMLElement).getByRole("link", { name: webText(item.labelKey) })).toHaveAttribute("data-status", "active");
    }
  });

  it("gives every tab, the top bar links and the sign-in link a 44 px target", async () => {
    setViewportWidth(360);
    asZaloBrowser();
    fakeServer();
    renderSite("/");
    await screen.findByRole("heading", { level: 1, name: HOME_TITLE });
    for (const link of within(tabs() as HTMLElement).getAllByRole("link")) expect(link).toHaveClass("h-14", "min-h-11");
    // The sign-in pill is drawn 32 px tall; its ::after tap area adds 12 px (the browser check measures it).
    expect(await screen.findByRole("link", { name: webText("sign_in_link") })).toHaveClass("h-8", "after:-top-1.5", "after:-bottom-1.5");
    for (const link of within(document.querySelector("[data-top-nav]") as HTMLElement).getAllByRole("link", { hidden: true })) expect(link).toHaveClass("h-11");
  });

  it("hides the bottom bar while a text field has focus (the keyboard is open) and brings it back after", async () => {
    setViewportWidth(360);
    asZaloBrowser();
    fakeServer();
    renderSite("/dang-nhap");
    const code = await screen.findByLabelText(webText("sign_in_code"));
    expect(tabs()).not.toBeNull();
    act(() => code.focus());
    await waitFor(() => expect(tabs()).toBeNull());
    act(() => code.blur());
    await waitFor(() => expect(tabs()).not.toBeNull());
  });
});

describe("Story 7.1 shell: top bar, offline strip, lang and the not-found page", () => {
  it("shows Sign in when signed out and the customer code, opening the account menu, when signed in", async () => {
    fakeServer({ session: LAN });
    const user = userEvent.setup();
    renderSite("/huong-dan");
    await user.click(await screen.findByRole("button", { name: webText("account_menu", { code: LAN.customerCode }) }));
    const sheet = await screen.findByRole("dialog", { name: webText("account_title") });
    expect(within(sheet).getByRole("button", { name: uiText("code_copy", { code: LAN.customerCode }) })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: webText("sign_out") }));
    expect(await screen.findByRole("link", { name: webText("sign_in_link") })).toBeInTheDocument();
  });

  it("shows the offline strip while the browser has no network", async () => {
    fakeServer();
    renderSite("/");
    await screen.findByRole("heading", { level: 1, name: HOME_TITLE });
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    act(() => void fireEvent(window, new Event("offline")));
    expect(await screen.findByText(webText("offline"))).toBeInTheDocument();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    act(() => void fireEvent(window, new Event("online")));
    await waitFor(() => expect(screen.queryByText(webText("offline"))).toBeNull());
  });

  it("sets lang=vi on the page and has a first-load skeleton without text", () => {
    const html = readFileSync(resolve("index.html"), "utf8");
    expect(html).toMatch(/<html lang="vi">/);
    const skeleton = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";
    expect(skeleton).toContain("data-skeleton");
    expect(skeleton.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim()).toBe("");
  });

  it("shows the not-found page with the way home on an unknown path", async () => {
    fakeServer();
    renderSite("/khong-co");
    expect(await screen.findByRole("heading", { level: 1, name: webText("not_found_title") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: webText("not_found_action") })).toHaveAttribute("href", "/");
  });
});
