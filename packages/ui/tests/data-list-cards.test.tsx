/**
 * The customer website's list controls (`form="cards"`, Story 7.4, pen.dev ktmGZ, jW4fD, YtS6u):
 * the heading with the sort dropdown, on a phone one filter button naming the choice and its count
 * that opens the statuses in a sheet, wider the chips in line (in the list's short words), and under
 * the rows the range, "show more" and the list's own link. No search box, refresh or pager unless
 * the list asks. The desk's adaptive form keeps its own controls (data-list.test.tsx).
 */
import { listSearch, type ListResponse, type ListSearchState } from "@cashback/contracts";
import { storedValues } from "@cashback/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { DataList, statusLabel, uiText, useListQuery, type ListColumn } from "../src/index";
import { moreState } from "../src/data-list/list-cards-controls";
import { setViewportWidth } from "./viewport";

interface Line {
  readonly id: string;
  readonly status: string;
  readonly recordedAt: string;
}

const SEARCH = listSearch({ sortable: ["recordedAt"], filters: [{ field: "status", values: storedValues("order") }], defaultSort: { field: "recordedAt", direction: "desc" }, pageSizes: [20, 40] });
const COLUMNS: readonly ListColumn<Line>[] = [{ key: "recordedAt", header: "Recorded", kind: "instant", sortable: true }];

function answer(total: number, extra: Partial<ListResponse<Line>> = {}): ListResponse<Line> {
  const rows = Array.from({ length: Math.min(total, 3) }, (_, i) => ({ id: `L${i}`, status: "APPROVED", recordedAt: "2026-10-30T05:00:00.000Z" }));
  return { rows, total, overall: total, page: 1, pageSize: 20, facets: { status: [{ value: "APPROVED", count: total - 1 }, { value: "PAID", count: 1 }] }, summary: {}, asOf: "2026-10-30T12:00:00.000Z", ...extra };
}

function renderCards(respond: (query: string) => ListResponse<Line>) {
  const requests: string[] = [];
  const states: ListSearchState[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Screen() {
    const [state, setState] = useState<ListSearchState>(SEARCH.defaults);
    const query = useListQuery({
      key: ["cards"],
      search: SEARCH,
      state,
      fetchList: async (q) => {
        requests.push(q);
        return respond(q);
      },
    });
    return (
      <DataList
        form="cards"
        searchable={false}
        title={<h2>My orders</h2>}
        search={SEARCH}
        state={state}
        onStateChange={(next) => {
          states.push(next);
          setState(next);
        }}
        query={query}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        searchPlaceholder=""
        countLabel={(count) => `${count} lines`}
        emptyText="No lines."
        statusFilter={{ field: "status", entity: "order", labels: { PAID: "Sent" } }}
        sortLabel={(_, direction) => (direction === "desc" ? "Newest" : "Oldest")}
        card={(row) => <p data-line>{row.id}</p>}
        footerLink={<a href="/missing">Missing?</a>}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Screen />
    </QueryClientProvider>,
  );
  return { requests, states };
}

describe("DataList cards form (customer website)", () => {
  it("phone: heading and sort dropdown on one line, one filter button naming the choice and the count, the statuses in a sheet", async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    const { requests } = renderCards((q) => (q.includes("filter%5Bstatus%5D=PAID") || q.includes("filter[status]=PAID") ? answer(1) : answer(18)));
    await screen.findAllByText(/^L\d$/);
    const sort = screen.getByRole("combobox", { name: uiText("list_sort_label") });
    expect(sort).toHaveDisplayValue("Newest");
    expect(screen.getByRole("heading", { name: "My orders" }).parentElement?.parentElement).toContainElement(sort);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: uiText("list_refresh") })).toBeNull();
    expect(screen.queryByRole("group", { name: uiText("list_status_group") })).toBeNull();
    await user.click(screen.getByRole("button", { name: uiText("list_filters_choice", { choice: uiText("list_all"), count: "18" }) }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Sent 1" }));
    await waitFor(() => expect(requests.some((q) => /filter(%5B|\[)status(%5D|\])=PAID/.test(q))).toBe(true));
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: uiText("list_filters_choice", { choice: "Sent", count: "1" }) })).toBeInTheDocument();
  });

  it("wider: the chips in line in the list's words (the registry's for the rest), no filter button", async () => {
    setViewportWidth(1440);
    renderCards(() => answer(18));
    const chips = await screen.findByRole("group", { name: uiText("list_status_group") });
    expect(await within(chips).findByRole("button", { name: "Sent 1" })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: `${statusLabel("status_approved")} 17` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^B/ })).toBeNull();
  });

  it("under the rows: the range, 'show more' growing the first page while a bigger size exists, then the next page; and the list's link", async () => {
    setViewportWidth(1440);
    const user = userEvent.setup();
    const { states } = renderCards(() => answer(58));
    const foot = await screen.findByRole("navigation", { name: uiText("list_pagination") });
    expect(foot).toHaveTextContent("1–20 / 58");
    expect(within(foot).getByRole("link", { name: "Missing?" })).toHaveAttribute("href", "/missing");
    await user.click(within(foot).getByRole("button", { name: uiText("list_more") }));
    expect(states.at(-1)).toMatchObject({ page: 1, pageSize: 40 });
    expect(moreState(SEARCH, { ...SEARCH.defaults, pageSize: 40 })).toMatchObject({ page: 2, pageSize: 40 });
    expect(moreState(SEARCH, { ...SEARCH.defaults, page: 2 })).toMatchObject({ page: 3, pageSize: 20 });
  });

  it("no 'show more' once every row is shown; with no record at all only the heading and the empty text", async () => {
    setViewportWidth(390);
    renderCards(() => answer(3, { overall: 3 }));
    const foot = await screen.findByRole("navigation", { name: uiText("list_pagination") });
    expect(within(foot).queryByRole("button")).toBeNull();
  });

  it("an empty list keeps its heading, shows the empty text and no controls", async () => {
    setViewportWidth(390);
    renderCards(() => ({ ...answer(0), rows: [], overall: 0, facets: { status: [] } }));
    expect(await screen.findByText("No lines.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My orders" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /\(0\)/ })).toBeNull();
  });
});
