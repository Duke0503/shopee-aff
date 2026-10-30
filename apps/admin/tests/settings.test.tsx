/**
 * Story 4.18 on the admin desk: the withheld settlement periods on Settings. A Shopee period is a
 * switch, on by default; an AccessTrade period is always withheld and has no switch (AC1). The
 * change asks once, with the server's count of orders it reaches and the line that approved
 * orders keep their amount (AC2); confirming sends only the new setting (AC3, the server records
 * the staff member); a refused save puts the switch back with the label file's error (AC4).
 */
import type { SettlementPeriodsResponse } from "@cashback/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { adminText, errorText } from "../src/labels";
import { SETTLEMENT_PERIODS_KEY } from "../src/settings/settlement-periods.queries";
import { EMPLOYEE, envelope, fakeServer, json, renderDesk, settle, type Answer, type Route } from "./app-harness";
import { setViewportWidth } from "./viewport";

const PERIODS: SettlementPeriodsResponse = {
  currentMonth: "2026-10",
  periods: [
    { network: "shopee", periodMonth: "2026-10", withheld: true, editable: true, origin: "NETWORK", basedOn: "1034567" },
    { network: "shopee", periodMonth: "2026-09", withheld: true, editable: true, origin: "CUTOVER", basedOn: null },
    { network: "accesstrade", periodMonth: "2026-10", withheld: true, editable: false, origin: "DEFAULT", basedOn: null },
  ],
};

function periodServer(save: () => Answer = () => json(200, { network: "shopee", periodMonth: "2026-10", withheld: false, editable: true, origin: "STAFF", basedOn: null })) {
  const posts: { path: string; body: unknown }[] = [];
  const impacts: string[] = [];
  let saved = false;
  const route: Route = (url, init) => {
    if (!url.pathname.startsWith("/api/admin/settlement-periods")) return undefined;
    if ((init?.method ?? "GET") === "POST") {
      posts.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
      const answer = save();
      saved = answer.status === 200;
      return answer;
    }
    if (url.pathname.endsWith("/impact")) {
      impacts.push(url.search);
      return json(200, { network: "shopee", periodMonth: "2026-10", withheld: false, affected: 7 });
    }
    return json(200, saved ? { ...PERIODS, periods: PERIODS.periods.map((p, i) => (i === 0 ? { ...p, withheld: false, origin: "STAFF" as const, basedOn: null } : p)) } : PERIODS);
  };
  return { route, posts, impacts };
}

async function settings(server = periodServer()) {
  fakeServer({ session: EMPLOYEE, routes: [server.route] });
  const view = renderDesk("/admin/settings");
  await settle(view.queryClient, SETTLEMENT_PERIODS_KEY);
  return { ...view, server };
}

const shopeeSwitch = (period: string) => screen.getByRole("switch", { name: adminText("settings_withheld_switch_aria", { period, network: adminText("network_shopee") }) });

describe("Story 4.18 acceptance criteria on the desk", () => {
  it("AC1: Shopee periods are switches, on by default or as the latest network batch says (named); the AccessTrade period reads always withheld and has no switch", async () => {
    await settings();
    expect(shopeeSwitch("10/2026")).toHaveAttribute("aria-checked", "true");
    expect(shopeeSwitch("09/2026")).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByText(adminText("settings_basis_network", { payout: "1034567" }))).toBeInTheDocument();
    const accesstrade = document.querySelector("[data-period='accesstrade:2026-10']") as HTMLElement;
    expect(within(accesstrade).getByText(adminText("settings_always_withheld"))).toBeInTheDocument();
    expect(within(accesstrade).queryByRole("switch")).toBeNull();
  });

  it("AC2: the confirmation shows the server's count of orders reached and says approved orders keep their amount; cancelling changes nothing", async () => {
    const user = userEvent.setup();
    const { server } = await settings();
    await user.click(shopeeSwitch("10/2026"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: adminText("settings_confirm_title_off", { period: "10/2026" }) })).toBeInTheDocument();
    expect(await within(dialog).findByText(adminText("settings_confirm_affected", { count: 7 }))).toBeInTheDocument();
    expect(within(dialog).getByText(adminText("settings_confirm_keep"))).toBeInTheDocument();
    expect(server.impacts).toEqual(["?withheld=false"]);
    await user.click(within(dialog).getByRole("button", { name: adminText("settings_cancel") }));
    expect(server.posts).toEqual([]);
    expect(shopeeSwitch("10/2026")).toHaveAttribute("aria-checked", "true");
  });

  it("AC3: confirming sends only the new setting and the switch shows the stored result", async () => {
    const user = userEvent.setup();
    const { server } = await settings();
    await user.click(shopeeSwitch("10/2026"));
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText(adminText("settings_confirm_affected", { count: 7 }));
    await user.click(within(dialog).getByRole("button", { name: adminText("settings_confirm") }));
    expect(server.posts).toEqual([{ path: "/api/admin/settlement-periods/shopee/2026-10", body: { withheld: false } }]);
    await waitFor(() => expect(shopeeSwitch("10/2026")).toHaveAttribute("aria-checked", "false"));
  });

  it("AC4: a refused save puts the switch back to the stored setting and shows the label file's error", async () => {
    const user = userEvent.setup();
    await settings(periodServer(() => envelope(409, "conflict", "error.settlement_period.always_withheld")));
    await user.click(shopeeSwitch("10/2026"));
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText(adminText("settings_confirm_affected", { count: 7 }));
    await user.click(within(dialog).getByRole("button", { name: adminText("settings_confirm") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(errorText("error.settlement_period.always_withheld", "conflict"));
    await waitFor(() => expect(shopeeSwitch("10/2026")).toHaveAttribute("aria-checked", "true"));
  });

  it("on a phone the rows fit the width and the switch is a large target", async () => {
    setViewportWidth(390);
    await settings();
    expect(shopeeSwitch("10/2026").className).toContain("coarse:h-8");
  });
});
