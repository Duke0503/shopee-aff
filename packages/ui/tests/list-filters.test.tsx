/**
 * Story 4.13 on the shared list: the overall total named as such on the "all" chip and in the
 * summary (list-defects Orders "All (N)"), one network choice, and the date filter whose quick
 * choices are Vietnam days with the whole last day (list-defects Orders "Today returns nothing").
 */
import { fixedClock } from "@cashback/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DateFilter, OptionFilter, presetRange, uiText } from "../src/index";
import { listOf, orderRow, renderList } from "./list-harness";

const CLOCK = fixedClock("2026-10-29T23:30:00.000Z");

describe("the overall total (AC4)", () => {
  it("the 'all' chip shows the overall total and is named as the overall total; the summary says it apart from the filtered count", async () => {
    renderList(() => Promise.resolve(listOf([orderRow(1), orderRow(2)], { overall: 4912 })), { q: "lan" });
    await screen.findByText("Customer 1");
    const all = screen.getByRole("button", { name: uiText("list_all_overall", { total: "4.912" }) });
    expect(all).toHaveTextContent("4.912");
    const summary = screen.getAllByText("2 orders").map((n) => n.closest("p")).find((p) => p !== null) as HTMLElement;
    expect(summary).toHaveTextContent(uiText("list_total_overall", { total: "4912 orders" }));
  });
});

describe("one network choice and the date filter (AC1, AC4)", () => {
  it("the network select is one filter with an 'all' option, and choosing one resets the page and sends it", async () => {
    const user = userEvent.setup();
    const { harness } = renderList(() => Promise.resolve(listOf([orderRow(1)])), { page: 3 }, (api) => (
      <OptionFilter api={api} field="network" label="Network" allLabel="All networks" options={[{ value: "shopee", label: "Shopee" }, { value: "accesstrade", label: "AccessTrade" }]} />
    ));
    await screen.findByText("Customer 1");
    expect(screen.getAllByRole("combobox", { name: "Network" })).toHaveLength(1);
    await user.selectOptions(screen.getByRole("combobox", { name: "Network" }), "shopee");
    expect(harness.states.at(-1)).toMatchObject({ page: 1, filters: { network: ["shopee"] } });
    expect(harness.requests.at(-1)).toContain("filter%5Bnetwork%5D=shopee");
  });

  it("'today' at 06:30 Vietnam time sends the Vietnam day; another date kind keeps the days in one change", async () => {
    const user = userEvent.setup();
    const fields = [
      { value: "recordedAt", label: "Recorded" },
      { value: "approvedAt", label: "Approved" },
    ];
    const { harness } = renderList(() => Promise.resolve(listOf([orderRow(1)])), {}, (api) => <DateFilter api={api} fields={fields} clock={CLOCK} />);
    await screen.findByText("Customer 1");
    expect(presetRange("today", CLOCK)).toBe("2026-10-30");
    await user.selectOptions(screen.getByRole("combobox", { name: uiText("list_date_days") }), uiText("list_date_today"));
    expect(harness.states.at(-1)?.filters).toEqual({ recordedAt: ["2026-10-30"] });
    const before = harness.states.length;
    await user.selectOptions(screen.getByRole("combobox", { name: uiText("list_date_kind") }), "approvedAt");
    expect(harness.states.length).toBe(before + 1);
    expect(harness.states.at(-1)?.filters).toEqual({ approvedAt: ["2026-10-30"] });
    await user.selectOptions(screen.getByRole("combobox", { name: uiText("list_date_days") }), uiText("list_date_this_month"));
    expect(harness.states.at(-1)?.filters).toEqual({ approvedAt: ["2026-10-01..2026-10-31"] });
  });

  it("a range from a shared link that is no quick choice is shown as its own option", async () => {
    renderList(() => Promise.resolve(listOf([orderRow(1)])), { filters: { recordedAt: ["2025-12-24..2026-01-02"] } }, (api) => <DateFilter api={api} fields={[{ value: "recordedAt", label: "Recorded" }]} clock={CLOCK} />);
    await screen.findByText("Customer 1");
    const days = screen.getByRole("combobox", { name: "Recorded" }) as HTMLSelectElement;
    expect(screen.queryByRole("combobox", { name: uiText("list_date_kind") })).toBeNull();
    expect(within(days).getByRole("option", { selected: true })).toHaveTextContent(uiText("list_date_range", { from: "24/12/2025", to: "02/01" }));
  });
});
