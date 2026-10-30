/**
 * Stories 4.14 and 4.15 on the shared list: quick chips over a facet field count the filtered set
 * the server sent (LC-6) and toggle the field's filter, and the tablet table's columns menu shows a
 * secondary column again without changing any value (Story 4.14 AC6).
 */
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FacetChips, formatMoney, uiText } from "../src/index";
import { listOf, orderRow, renderList } from "./list-harness";
import { setViewportWidth } from "./viewport";

const CHOICES = [
  { field: "network", value: "shopee", label: "Shopee" },
  { field: "network", value: "accesstrade", label: "AccessTrade" },
];

describe("quick facet chips", () => {
  it("each chip shows the server's count for the filtered set, toggles its value and goes back to page 1; 'all' clears the field", async () => {
    const user = userEvent.setup();
    const facets = { network: [{ value: "shopee", count: 7 }] };
    const { harness } = renderList(
      () => Promise.resolve(listOf([orderRow(1)], { facets })),
      { page: 2 },
      (api) => <FacetChips api={api} choices={CHOICES} label="Networks" />,
    );
    await screen.findByText("Customer 1");
    const group = screen.getByRole("group", { name: "Networks" });
    expect(within(group).getByRole("button", { name: "Shopee 7" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "AccessTrade 0" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: `${uiText("list_all")} 1` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(group).getByRole("button", { name: "Shopee 7" }));
    expect(harness.states.at(-1)).toMatchObject({ page: 1, filters: { network: ["shopee"] } });
    await user.click(within(group).getByRole("button", { name: uiText("list_all") }));
    expect(harness.states.at(-1)?.filters).toEqual({});
  });

  it("with hideEmpty, a value absent from the filtered set has no chip unless it is on", async () => {
    renderList(
      () =>
        Promise.resolve(
          listOf([orderRow(1)], { facets: { network: [{ value: "shopee", count: 3 }] } }),
        ),
      { filters: { network: ["accesstrade"] } },
      (api) => <FacetChips api={api} choices={CHOICES} label="Networks" hideEmpty />,
    );
    await screen.findByText("Customer 1");
    const group = screen.getByRole("group", { name: "Networks" });
    expect(within(group).getByRole("button", { name: "Shopee 3" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "AccessTrade 0" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("the tablet columns menu", () => {
  it("lists the secondary columns, shows one again on request, and never changes a value", async () => {
    const user = userEvent.setup();
    setViewportWidth(768);
    renderList(() => Promise.resolve(listOf([orderRow(1)])));
    await screen.findByText("Customer 1");
    expect(screen.queryByRole("columnheader", { name: "Product" })).toBeNull();
    const amount = screen.getByText(formatMoney(9264) ?? "");
    await user.click(screen.getByRole("button", { name: uiText("list_columns") }));
    await user.click(screen.getByRole("checkbox", { name: "Product" }));
    expect(screen.getByRole("columnheader", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByText(formatMoney(9264) ?? "").textContent).toBe(amount.textContent);
    act(() => setViewportWidth(1440));
    expect(screen.queryByRole("button", { name: uiText("list_columns") })).toBeNull();
  });
});
