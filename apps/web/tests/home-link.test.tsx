/**
 * Story 7.6 (website side): the link converter on Home. An unknown code is said under the code
 * field; a guest link has its warning above the link and the Zalo button first; a busy website is
 * the Zalo hand-off with no retry; a made link shows product, price, the estimate and the share
 * link with "open" and "copy"; a Lazada link gets the server's refusal; inside the Zalo in-app
 * browser nothing opens a pop-up or a new window. The server side is in
 * apps/server/tests/web-link.test.ts.
 */
import { WEB_LINK_PATH, type WebLinkResult } from "@cashback/contracts";
import { formatMoney, uiText } from "@cashback/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { errorText, webText } from "../src/labels";
import { asZaloBrowser, envelope, fakeServer, json, LAN, renderSite, type Answer, type Route } from "./app-harness";
import { FACTS_POLLS_MAX, nextPoll, readyPollsOf } from "../src/link/link.queries";
import { setViewportWidth } from "./viewport";

const LINK = "https://shopee.vn/Ao-thun-i.11001.22001";
const TICKET = "26110100001.abcdefghijklmnopqrstuvwx";
const READY: WebLinkResult = {
  state: "ready",
  guest: false,
  factsSettled: true,
  network: "shopee",
  perShop: false,
  product: { name: "Ao thun cotton", imageUrl: null, price: 159000 },
  estimate: { cashback: 7234, withheld: true },
  sharePath: "/s/Ab12Cd34Ef",
};

interface Answers {
  readonly queue?: (body: Record<string, unknown>) => Answer;
  /** The results the page reads, one per poll; the last one repeats. */
  readonly results?: readonly WebLinkResult[];
}

function server({ queue, results = [READY] }: Answers = {}, session: typeof LAN | null = null) {
  let polls = 0;
  const route: Route = (url, init) => {
    if (url.pathname === WEB_LINK_PATH && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return queue?.(body) ?? json(200, { ticket: TICKET, guest: body["customerCode"] === undefined && session === null, customerCode: session?.customerCode ?? (body["customerCode"] as string | undefined) ?? null });
    }
    if (url.pathname.startsWith(`${WEB_LINK_PATH}/`)) return json(200, results[Math.min(polls++, results.length - 1)]);
    return undefined;
  };
  return fakeServer({ session, routes: [route] });
}

async function convert(user: ReturnType<typeof userEvent.setup>, url: string, code?: string) {
  await user.type(await screen.findByLabelText(webText("link_url_label")), url);
  if (code !== undefined) {
    await user.click(screen.getByRole("button", { name: webText("home_code_toggle") }));
    await user.type(await screen.findByLabelText(webText("link_code_label")), code);
  }
  await user.click(screen.getByRole("button", { name: webText("link_submit") }));
}

const posted = (site: ReturnType<typeof server>) => site.requests.filter((r) => r.url.pathname === WEB_LINK_PATH && r.method === "POST").map((r) => r.body);

describe("Story 7.6: Home link converter with a customer code or as a guest", () => {
  it("AC1: an unknown customer code shows 'Khong tim thay ma khach hang' under the code field and no link", async () => {
    server({ queue: () => envelope(404, "not_found", "error.web_link.customer_unknown", { customerCode: "error.web_link.customer_unknown" }) });
    const user = userEvent.setup();
    renderSite("/");
    await convert(user, LINK, "DP99999");
    const error = await screen.findByText(errorText("error.web_link.customer_unknown", "not_found"));
    expect(error.textContent).toBe("Kh\u00f4ng t\u00ecm th\u1ea5y m\u00e3 kh\u00e1ch h\u00e0ng");
    expect(screen.getByLabelText(webText("link_code_label"))).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector("[data-link-result]")).toBeNull();
  });

  it("AC2: without a code the result is a guest link: the warning above the link, the Zalo button first", async () => {
    const site = server({ results: [{ ...READY, guest: true, estimate: null }] });
    const user = userEvent.setup();
    renderSite("/");
    await convert(user, LINK);
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-link-result='guest']");
      if (found === null) throw new Error("no result yet");
      return found;
    });
    expect(posted(site)).toEqual([{ url: LINK }]);
    const warning = within(card).getByText(webText("link_guest_title"));
    const zalo = card.querySelector("[data-zalo-button]") as HTMLElement;
    const open = within(card).getByRole("link", { name: webText("link_guest_open") });
    expect(warning.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(zalo.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(open).toHaveAttribute("href", READY.sharePath);
    expect(card).not.toHaveTextContent(uiText("money_estimate_tag"));
  });

  it("AC3: a busy website (web_busy) shows the Zalo hand-off panel in place of the result, with no retry button", async () => {
    server({ queue: () => envelope(429, "rate_limited", "error.link.web_busy") });
    const user = userEvent.setup();
    renderSite("/");
    await convert(user, LINK, "DP00012");
    const panel = await screen.findByText(webText("link_busy"));
    const section = panel.closest("section") as HTMLElement;
    expect(section.querySelector("[data-zalo-button]")).not.toBeNull();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: webText("retry") })).toBeNull();
    expect(document.querySelector("[data-link-result]")).toBeNull();
  });

  it("AC4: with a valid code the page polls while the link is made, then shows product, price, 'khoang <amount>' with the estimate tag, 'open' and 'copy'", async () => {
    const creating: WebLinkResult = { ...READY, state: "creating", sharePath: null, factsSettled: false, estimate: null };
    server({ results: [creating, READY] });
    const user = userEvent.setup();
    renderSite("/");
    await convert(user, LINK, "DP00012");
    expect(await screen.findByText(webText("link_creating"), { selector: "[role=status]" })).toBeInTheDocument();
    const card = await waitFor(
      () => {
        const found = document.querySelector<HTMLElement>("[data-link-result='customer']");
        if (found === null) throw new Error("no result yet");
        return found;
      },
      { timeout: 6000 },
    );
    expect(card).toHaveTextContent("Ao thun cotton");
    expect(card.querySelector("[data-product-meta]")).toHaveTextContent(`${webText("platform_shopee")} \u00b7 ${formatMoney(159000) ?? ""}`);
    const estimate = card.querySelector("[data-estimate]");
    expect(estimate).toHaveTextContent(`${webText("link_cashback_label")}${uiText("money_estimate_tag")}`);
    expect(estimate).toHaveTextContent(`${uiText("money_about")}${formatMoney(7234) ?? ""}`);
    expect(within(card).getByRole("link", { name: webText("link_open") })).toHaveAttribute("href", READY.sharePath);
    expect(within(card).getByRole("button", { name: webText("link_copy") })).toBeInTheDocument();
    expect(card.querySelector("[data-share-url]")).toHaveTextContent(`${window.location.host}${READY.sharePath ?? ""}`);
  });

  it("AC4: without an estimate the card says so instead of an amount", async () => {
    server({ results: [{ ...READY, estimate: null }] });
    const user = userEvent.setup();
    renderSite("/");
    await convert(user, LINK, "DP00012");
    expect(await screen.findByText(webText("link_no_estimate"))).toBeInTheDocument();
    expect(document.querySelector("[data-estimate]")).toBeNull();
  });

  it("AC5: a Lazada link shows the server's polite refusal under the link field", async () => {
    server({ queue: () => envelope(400, "invalid_request", "error.link.network_unsupported") });
    const user = userEvent.setup();
    renderSite("/");
    await convert(user, "https://www.lazada.vn/products/ao-i1.html");
    expect(await screen.findByText(errorText("error.link.network_unsupported", "invalid_request"))).toBeInTheDocument();
    expect(screen.getByLabelText(webText("link_url_label"))).toHaveAttribute("aria-invalid", "true");
  });

  it("AC6: in the Zalo in-app browser on a phone the flow completes without pop-ups or new windows", async () => {
    setViewportWidth(360);
    asZaloBrowser();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    server();
    const user = userEvent.setup();
    renderSite("/");
    await convert(user, LINK, "DP00012");
    await waitFor(() => expect(document.querySelector("[data-link-result='customer']")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: webText("link_copy") }));
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelectorAll("a[target]")).toHaveLength(0);
    open.mockRestore();
  });

  it("a signed-in customer has no code field: the link carries their own code", async () => {
    const site = server({}, LAN);
    const user = userEvent.setup();
    renderSite("/");
    const own = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-link-own-code]");
      if (found === null) throw new Error("not yet");
      return found;
    });
    expect(own).toHaveTextContent(LAN.customerCode);
    expect(screen.queryByLabelText(webText("link_code_label"))).toBeNull();
    await user.type(screen.getByLabelText(webText("link_url_label")), LINK);
    await user.click(screen.getByRole("button", { name: webText("link_submit") }));
    await waitFor(() => expect(posted(site)).toEqual([{ url: LINK }]));
  });

  it("an empty link or a malformed code is said under the field before anything is sent", async () => {
    const site = server();
    const user = userEvent.setup();
    renderSite("/");
    await user.click(await screen.findByRole("button", { name: webText("home_code_toggle") }));
    await user.type(await screen.findByLabelText(webText("link_code_label")), "abc");
    await user.click(screen.getByRole("button", { name: webText("link_submit") }));
    expect(await screen.findByText(webText("link_url_required"))).toBeInTheDocument();
    expect(screen.getByText(errorText("error.customer_code_format", "invalid_request"))).toBeInTheDocument();
    expect(posted(site)).toEqual([]);
  });
});

describe("Story 7.6 review 3: a made link still waiting for its facts is asked a bounded number of times, counted in answers", () => {
  it("AC4: re-rendering does not count; each new answer does; polling stops after the last allowed answer", () => {
    const waiting: WebLinkResult = { ...READY, factsSettled: false };
    const query = { state: { data: waiting, dataUpdatedAt: 1000 } } as unknown as Parameters<typeof readyPollsOf>[0];
    for (let render = 0; render < 5; render++) expect(readyPollsOf(query)).toBe(1);
    for (let answer = 2; answer <= FACTS_POLLS_MAX; answer++) {
      (query.state as { dataUpdatedAt: number }).dataUpdatedAt = 1000 + answer;
      expect(readyPollsOf(query)).toBe(answer);
    }
    expect(nextPoll(waiting, FACTS_POLLS_MAX - 1)).not.toBe(false);
    expect(nextPoll(waiting, FACTS_POLLS_MAX)).toBe(false);
    expect(nextPoll(READY, 1)).toBe(false);
    expect(nextPoll({ ...READY, state: "creating" }, 0)).not.toBe(false);
  });
});
