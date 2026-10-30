import type { ListResponse } from "@cashback/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListFetchError, statusLabel, uiText } from "../src/index";
import { deferred, listOf, orderRow, renderList, type OrderRow } from "./list-harness";
import { setViewportWidth } from "./viewport";

const rows = (n: number, from = 1): OrderRow[] => Array.from({ length: n }, (_, i) => orderRow(from + i));
const answer = (list: ListResponse<OrderRow>) => () => Promise.resolve(list);

afterEach(() => {
  vi.useRealTimers();
});

describe("Story 4.5 AC2: search fires 300 ms after the last key, Enter at once, late answers discarded", () => {
  it("sends one request 300 ms after the last key and none per key", async () => {
    const { harness } = renderList(answer(listOf(rows(3))));
    await screen.findByText("Customer 1");
    expect(harness.requests).toHaveLength(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const box = screen.getByRole("searchbox");
    for (const typed of ["n", "ng", "ngu"]) {
      fireEvent.change(box, { target: { value: typed } });
      act(() => void vi.advanceTimersByTime(200));
    }
    expect(harness.requests).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(99));
    expect(harness.requests).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    vi.useRealTimers();
    await waitFor(() => expect(harness.requests).toHaveLength(2));
    expect(harness.requests[1]).toContain("q=ngu");
  });

  it("fires at once on Enter", async () => {
    const user = userEvent.setup();
    const { harness } = renderList(answer(listOf(rows(3))));
    await screen.findByText("Customer 1");
    await user.type(screen.getByRole("searchbox"), "lan{Enter}");
    expect(harness.requests.at(-1)).toContain("q=lan");
    expect(harness.states.at(-1)?.page).toBe(1);
  });

  it("keeps the previous rows dimmed under the progress line, then discards a late answer for an older query", async () => {
    const first = deferred<ListResponse<OrderRow>>();
    const second = deferred<ListResponse<OrderRow>>();
    const answers = [Promise.resolve(listOf([orderRow(1)])), first.promise, second.promise];
    const user = userEvent.setup();
    const { container } = renderList(() => answers.shift() ?? Promise.reject(new Error("unexpected")));
    await screen.findByText("Customer 1");

    await user.type(screen.getByRole("searchbox"), "a{Enter}");
    expect(screen.getByText("Customer 1")).toBeInTheDocument();
    expect(container.querySelector(".opacity-55")).not.toBeNull();
    expect(container.querySelector("[data-progress=on]")).not.toBeNull();

    await user.type(screen.getByRole("searchbox"), "b{Enter}");
    await act(async () => second.resolve(listOf([orderRow(2, { customerName: "Answer for ab" })])));
    await screen.findByText("Answer for ab");
    await act(async () => first.resolve(listOf([orderRow(3, { customerName: "Late answer for a" })])));
    expect(screen.queryByText("Late answer for a")).toBeNull();
    expect(screen.getByText("Answer for ab")).toBeInTheDocument();
    expect(container.querySelector("[data-progress=on]")).toBeNull();
  });
});

describe("Story 4.5 AC3: a failed request shows the error with retry, keeps previous rows stale, never the empty text", () => {
  it("shows the error and retry on a first load that fails, not the empty text", async () => {
    let fail = true;
    const user = userEvent.setup();
    const { harness } = renderList(() => (fail ? Promise.reject(new ListFetchError(500)) : Promise.resolve(listOf(rows(2)))));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(uiText("list_error_title"));
    expect(alert).toHaveTextContent(uiText("list_error_status", { status: 500 }));
    expect(screen.queryByText("No orders yet.")).toBeNull();
    expect(screen.queryByText(uiText("list_no_matches"))).toBeNull();

    fail = false;
    await user.click(within(alert).getByRole("button", { name: uiText("list_retry") }));
    await screen.findByText("Customer 1");
    expect(harness.requests).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the rows of the last success marked stale with their time when a later request fails", async () => {
    const user = userEvent.setup();
    const { container } = renderList((q) => (q.includes("q=x") ? Promise.reject(new ListFetchError(null)) : Promise.resolve(listOf(rows(2)))));
    await screen.findByText("Customer 1");
    await user.type(screen.getByRole("searchbox"), "x{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(uiText("list_error_title"));
    expect(alert).toHaveTextContent(uiText("list_error_network"));
    expect(alert).toHaveTextContent(uiText("list_stale", { time: "19:42" }));
    expect(screen.getByText("Customer 1")).toBeInTheDocument();
    expect(container.querySelector("[data-stale=true]")).not.toBeNull();
    expect(screen.queryByText(uiText("list_no_matches"))).toBeNull();
  });
});

describe("Story 4.5 AC4: sort affordances only on sortable columns; aria-sort, aria-pressed and counts", () => {
  it("renders sortable headers as buttons in cells with aria-sort and leaves the others plain", async () => {
    renderList(answer(listOf(rows(2))));
    await screen.findByText("Customer 1");
    const sorted = screen.getByRole("columnheader", { name: /Recorded/ });
    expect(sorted).toHaveAttribute("aria-sort", "descending");
    expect(within(sorted).getByRole("button", { name: "Recorded" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Cashback/ })).toHaveAttribute("aria-sort", "none");

    const plain = screen.getByRole("columnheader", { name: "Order" });
    expect(plain).not.toHaveAttribute("aria-sort");
    expect(within(plain).queryByRole("button")).toBeNull();
  });

  it("regression 'sortable headers that do nothing': a header click sends that field as the sort and resets the page", async () => {
    const user = userEvent.setup();
    const { harness } = renderList(answer(listOf(rows(2))), { page: 3 });
    await screen.findByText("Customer 1");
    await user.click(screen.getByRole("button", { name: "Cashback" }));
    expect(harness.requests.at(-1)).toContain("sort=cashback%3Adesc");
    expect(harness.states.at(-1)?.page).toBe(1);
    await waitFor(() => expect(screen.getByRole("columnheader", { name: /Cashback/ })).toHaveAttribute("aria-sort", "descending"));
    await user.click(screen.getByRole("button", { name: "Cashback" }));
    expect(harness.requests.at(-1)).toContain("sort=cashback%3Aasc");
  });

  it("gives every chip aria-pressed and its count in the accessible name, a zero chip included", async () => {
    renderList(answer(listOf(rows(3))));
    await screen.findByText("Customer 1");
    expect(screen.getByRole("button", { name: `${uiText("list_all")} 3` })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: `${statusLabel("status_approved")} 3` })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: `${statusLabel("status_awaiting_approval")} 0` })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Story 4.5 AC5: phone at 390 px shows cards, the sort Select and the filter sheet with the same counts", () => {
  it("renders compact cards: status and amount, product, who line, meta line with one labelled date", async () => {
    setViewportWidth(390);
    renderList(answer(listOf(rows(2))));
    const card = (await screen.findByText("Product 1")).closest("li") as HTMLElement;
    expect(screen.queryByRole("table")).toBeNull();
    const [head, title, who, meta] = [...card.children] as HTMLElement[];
    expect(within(head as HTMLElement).getByText(statusLabel("status_approved"))).toBeInTheDocument();
    expect(within(head as HTMLElement).getByLabelText(uiText("money_aria", { amount: "9.264" }))).toBeInTheDocument();
    expect(title).toHaveTextContent("Product 1");
    expect(within(title as HTMLElement).getByText("Product 1")).toHaveClass("line-clamp-2");
    expect(who).toHaveAttribute("data-card", "who");
    expect(within(who as HTMLElement).getByRole("button", { name: uiText("code_copy", { code: "DP00001" }) })).toBeInTheDocument();
    expect(who).toHaveTextContent("Customer 1");
    expect(meta).toHaveAttribute("data-card", "meta");
    expect(within(meta as HTMLElement).getByRole("button", { name: uiText("code_copy", { code: "2610000001" }) })).toBeInTheDocument();
    expect(meta).toHaveTextContent("Shopee · Rec. 30/10");
    expect(card.querySelectorAll("dt")).toHaveLength(0);
  });

  it("review item 11: shows the product snapshot image, lazy and square, and a placeholder when there is none", async () => {
    setViewportWidth(1440);
    const { container } = renderList(answer(listOf(rows(2))));
    await screen.findByText("Product 1");
    const image = container.querySelector("img[data-thumb=image]");
    expect(image).toHaveAttribute("src", "https://cf.example.test/file/p2.jpg");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("width", "32");
    expect(image).toHaveClass("size-8", "rounded-md", "object-cover");
    expect(container.querySelectorAll("[data-thumb=placeholder]")).toHaveLength(1);
  });

  it("review item 13: every sortable header puts its sort icon after the text", async () => {
    renderList(answer(listOf(rows(1))));
    await screen.findByText("Product 1");
    for (const name of ["Customer", "Status", "Cashback", "Recorded"]) {
      const button = screen.getByRole("button", { name });
      expect(button.lastElementChild?.tagName.toLowerCase()).toBe("svg");
      expect(button).not.toHaveClass("flex-row-reverse");
    }
  });

  it("puts the status chips in a bottom sheet with the same counts and offers every sortable column in the sort Select", async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    const { harness } = renderList(answer(listOf(rows(3))));
    await screen.findByText("Customer 1");
    expect(screen.queryByRole("button", { name: `${statusLabel("status_approved")} 3` })).toBeNull();
    await user.click(screen.getByRole("button", { name: uiText("list_filters_button") }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: `${statusLabel("status_approved")} 3` })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: `${statusLabel("status_awaiting_approval")} 0` })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: uiText("list_filters_done") }));

    const sort = screen.getByRole("combobox", { name: uiText("list_sort_label") });
    expect(within(sort).getAllByRole("option")).toHaveLength(8);
    await user.selectOptions(sort, "cashback:desc");
    expect(harness.requests.at(-1)).toContain("sort=cashback%3Adesc");
  });

  it("names the active filters on the sheet trigger", async () => {
    setViewportWidth(390);
    renderList(answer(listOf(rows(3))), { filters: { status: ["APPROVED", "PAID"] } });
    await screen.findByText("Customer 1");
    expect(screen.getByRole("button", { name: uiText("list_filters_button_active", { count: 2 }) })).toBeInTheDocument();
  });
});

describe("Story 4.5 AC6: a toggled chip resets to page 1 and the live region announces the new count", () => {
  it("resets the page, sends the filter and announces the count of the new answer", async () => {
    const user = userEvent.setup();
    const { harness } = renderList((q) => Promise.resolve(q.includes("filter") ? listOf(rows(40)) : listOf(rows(25), { total: 120, page: 2 })), { page: 2 });
    await screen.findByText("Customer 1");
    await waitFor(() => expect(document.querySelector("[aria-live=polite]")).toHaveTextContent("120 orders"));
    await user.click(screen.getByRole("button", { name: new RegExp(`^${statusLabel("status_approved")}`) }));
    expect(harness.states.at(-1)).toMatchObject({ page: 1, filters: { status: ["APPROVED"] } });
    expect(harness.requests.at(-1)).toContain("filter%5Bstatus%5D=APPROVED");
    expect(harness.requests.at(-1)).not.toContain("page=");
    await waitFor(() => expect(document.querySelector("[aria-live=polite]")).toHaveTextContent("40 orders"));
  });
});

describe("list-defects root cause 8: the page is clamped and the URL corrected; no match differs from no records", () => {
  it("corrects page 3 to the page the server returned, in place", async () => {
    const { harness } = renderList(answer(listOf(rows(20, 21), { total: 40, page: 2, pageSize: 20 })), { page: 3, pageSize: 25 });
    await screen.findByText("Customer 21");
    await waitFor(() => expect(harness.states.at(-1)?.page).toBe(2));
    expect(harness.replaced.at(-1)).toBe(true);
    expect(screen.getByText("21–40 / 40")).toBeInTheDocument();
  });

  it("shows 'no matches' with clear filters when filters exclude every record, and the empty text only without filters", async () => {
    const user = userEvent.setup();
    const { harness } = renderList(answer(listOf([])), { q: "zzz" });
    await screen.findByText(uiText("list_no_matches"));
    expect(screen.queryByText("No orders yet.")).toBeNull();
    await user.click(screen.getByRole("button", { name: uiText("list_clear_filters") }));
    expect(harness.states.at(-1)).toMatchObject({ q: "", filters: {}, page: 1 });
    await screen.findByText("No orders yet.");
  });

  it("shows skeleton rows only on the first load", async () => {
    const pending = deferred<ListResponse<OrderRow>>();
    renderList(() => pending.promise);
    expect(screen.getByLabelText(uiText("list_loading"))).toHaveAttribute("aria-busy", "true");
    await act(async () => pending.resolve(listOf(rows(1))));
    await screen.findByText("Customer 1");
    expect(screen.queryByLabelText(uiText("list_loading"))).toBeNull();
  });
});
