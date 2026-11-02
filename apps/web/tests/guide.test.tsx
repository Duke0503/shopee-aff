/**
 * Story 7.7 (website side): the guide. Every percentage stands beside an example amount the server
 * sent (no amount or rate is typed in the page or its labels), the text promises no payout date and
 * no automatic transfer, the commands are those of Stories 6.7 and 6.8, and nothing is wider than a
 * 360 px phone. The figures themselves (packages/money: 100,000 dong gives 79,216 not withheld and
 * 71,216 withheld) are checked in apps/server/tests/guide-figures.test.ts.
 */
import { ASSISTANT_COMMANDS, GUIDE_PATH, type GuideFigures } from "@cashback/contracts";
import messages from "@cashback/labels/vi/messages.json";
import web from "@cashback/labels/vi/web.json";
import { formatMoney } from "@cashback/ui";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { webText } from "../src/labels";
import { GUIDE_COMMANDS } from "../src/pages/guide.page";
import { envelope, fakeServer, json, renderSite } from "./app-harness";
import { setViewportWidth } from "./viewport";

/** The server's answer for the real rules (apps/server/tests/guide-figures.test.ts checks these against packages/money). */
const REAL: GuideFigures = {
  feeBps: 98,
  taxBps: 1000,
  shareBps: 8000,
  shopeeCap: 40000,
  example: { price: 450000, shopeeRateBps: 260, commission: 11700, notWithheld: { fee: 115, tax: 0, net: 11585, cashback: 9268 }, withheld: { fee: 115, tax: 1170, net: 10415, cashback: 8332 } },
  capExample: { price: 2000000, shopeeRateBps: 300, xtraRateBps: 200, shopeePart: 40000, xtraPart: 40000, commission: 80000 },
};
/** Made-up figures: whatever the server says is what the page shows. */
const OTHER: GuideFigures = {
  feeBps: 150,
  taxBps: 500,
  shareBps: 7000,
  shopeeCap: 30000,
  example: { price: 300000, shopeeRateBps: 500, commission: 15000, notWithheld: { fee: 225, tax: 0, net: 14775, cashback: 10343 }, withheld: { fee: 225, tax: 750, net: 14025, cashback: 9818 } },
  capExample: { price: 900000, shopeeRateBps: 400, xtraRateBps: 100, shopeePart: 30000, xtraPart: 9000, commission: 39000 },
};

const GUIDE_LABELS = Object.entries(web).filter(([key]) => key.startsWith("guide_"));

function server(figures: GuideFigures | null) {
  return fakeServer({ routes: [(url) => (url.pathname === GUIDE_PATH ? (figures === null ? envelope(503, "busy", "error.busy") : json(200, figures)) : undefined)] });
}

const example = async () => waitFor(() => {
  const found = document.querySelector<HTMLElement>("[data-money-example]");
  if (found === null) throw new Error("not rendered yet");
  return found;
});

describe("Story 7.7: Basic guide page with the money rules stated correctly", () => {
  it("AC1: every percentage has an example amount from the server beside it (450,000 at 2.6% gives 9,268 and 8,332; the cap on its own example)", async () => {
    server(REAL);
    renderSite("/huong-dan");
    const block = await example();
    const rows = [...block.querySelectorAll("dl > div")];
    const withRate = rows.filter((row) => row.querySelector("dt")?.textContent?.includes("%"));
    expect(withRate.length).toBe(5);
    for (const row of withRate) expect(row.querySelector("dd")?.textContent).toMatch(/\d\u0111$/);
    const money = (n: number) => formatMoney(n) ?? "";
    expect(block).toHaveTextContent(webText("guide_split_lead", { price: money(450000), rate: "2,6%", commission: money(11700) }));
    expect(block.querySelector("[data-split='not-withheld']")).toHaveTextContent(`${webText("guide_split_cashback", { rate: "80%" })}${money(9268)}`);
    expect(block.querySelector("[data-split='withheld']")).toHaveTextContent(`${webText("guide_split_cashback", { rate: "80%" })}${money(8332)}`);
    expect(block).toHaveTextContent(`${webText("guide_split_fee", { rate: "0,98%" })}\u2212${money(115)}`);
    expect(block).toHaveTextContent(`${webText("guide_split_tax", { rate: "10%" })}\u2212${money(1170)}`);
    const cap = block.querySelector("[data-cap-example]");
    expect(cap).toHaveTextContent(webText("guide_split_cap", { cap: money(40000) }));
    expect(cap).toHaveTextContent(webText("guide_cap_example", { price: money(2000000), shopeeRate: "3%", shopeePart: money(40000), xtraRate: "2%", xtraPart: money(40000), commission: money(80000) }));
  });

  it("AC1: the amounts and rates are the server's, not typed in the page: other figures show as sent, and no guide label holds a digit or a percent sign", async () => {
    server(OTHER);
    renderSite("/huong-dan");
    const block = await example();
    expect(block).toHaveTextContent(webText("guide_split_cashback", { rate: "70%" }));
    expect(block).toHaveTextContent(formatMoney(10343) ?? "");
    expect(block).toHaveTextContent(formatMoney(39000) ?? "");
    expect(block).not.toHaveTextContent(formatMoney(9268) ?? "");
    for (const [key, text] of GUIDE_LABELS) expect([key, /[\d%]/.test(text.replace(/\{[a-z]+\}/g, ""))]).toEqual([key, false]);
  });

  it("AC1: when the figures cannot be read the split says so with a retry, never a typed amount", async () => {
    server(null);
    renderSite("/huong-dan");
    expect(await screen.findByText(webText("guide_split_error"))).toBeInTheDocument();
    expect(document.querySelector("[data-money-example]")).toBeNull();
  });

  it("AC2: the guide promises no payout date and no automatic transfer", async () => {
    server(REAL);
    renderSite("/huong-dan");
    await example();
    const text = (document.querySelector("main") ?? document.body).textContent?.toLowerCase() ?? "";
    const all = `${GUIDE_LABELS.map(([, t]) => t.toLowerCase()).join(" ")} ${text}`;
    for (const promise of ["t\u1ef1 \u0111\u1ed9ng", "h\u00e0ng tu\u1ea7n", "m\u1ed7i tu\u1ea7n", "h\u00e0ng th\u00e1ng", "trong v\u00f2ng", "ch\u1eadm nh\u1ea5t", "th\u1ee9 ", "s\u1ebd chuy\u1ec3n v\u00e0o ng\u00e0y", "t\u1ed1i thi\u1ec3u \u0111\u1ec3"]) expect([promise, all.includes(promise)]).toEqual([promise, false]);
    expect(webText("guide_step_pay")).toContain("Kh\u00f4ng h\u1eb9n ng\u00e0y c\u1ed1 \u0111\u1ecbnh");
  });

  it("AC3: the commands are those of Stories 6.7 and 6.8: /id, /sodu, /donhang, /stk, /matkhau, /help, each a copy chip named in /help", async () => {
    server(REAL);
    renderSite("/huong-dan");
    const list = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-guide-commands]");
      if (found === null) throw new Error("not rendered");
      return found;
    });
    const chips = [...list.querySelectorAll("button")].map((b) => b.textContent);
    expect(chips.sort()).toEqual(["/donhang", "/help", "/id", "/matkhau", "/sodu", "/stk"]);
    expect(GUIDE_COMMANDS).toHaveLength(ASSISTANT_COMMANDS.length);
    for (const chip of chips) expect(messages.command_help).toContain(`${chip ?? ""}:`);
  });

  it("AC4: at 360 px the page has no fixed width wider than the screen", async () => {
    setViewportWidth(360);
    server(REAL);
    renderSite("/huong-dan");
    await example();
    const fixed = [...document.querySelectorAll<HTMLElement>("main *")].flatMap((el) => [...el.classList]).filter((c) => /^(min-)?w-\[(\d+)px\]$/.test(c) && Number(/(\d+)px/.exec(c)?.[1]) > 328);
    expect(fixed).toEqual([]);
  });
});
