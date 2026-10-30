import { describe, expect, it } from "vitest";

import { LIST_MAX_PAGE, listQueryString, listSearch, parseSortParam, splitFilterValues } from "../src/index";

const orders = listSearch({
  sortable: ["customerName", "status", "cashback", "recordedAt"],
  filters: [{ field: "status", values: ["AWAITING_APPROVAL", "APPROVED", "PAID"] }, { field: "network" }],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

describe("Story 4.5 AC1: list URL state round-trips and leaves defaults out", () => {
  it("omits every default, so the plain list has a bare address", () => {
    expect(orders.toParams(orders.defaults)).toEqual({});
    expect(orders.validate({})).toEqual({});
  });

  it("turns a search, two chips and a sort into the URL and back into the same state", () => {
    const state = { ...orders.defaults, q: "nguyen", filters: { status: ["APPROVED", "PAID"] }, sort: { field: "cashback", direction: "asc" as const }, page: 3 };
    const params = orders.toParams(state);
    expect(params).toEqual({ q: "nguyen", "filter[status]": "APPROVED,PAID", sort: "cashback:asc", page: "3" });
    expect(orders.parse(params)).toEqual(state);
  });

  it("normalises a hand-edited URL: unknown keys, an unsortable field and a bad page fall back to defaults", () => {
    expect(orders.validate({ sort: "product:asc", page: "0", pageSize: "37", foo: "bar", "filter[product]": "x" })).toEqual({});
    expect(orders.validate({ sort: "cashback:sideways" })).toEqual({});
    expect(orders.validate({ "filter[status]": " APPROVED , ,APPROVED " })).toEqual({ "filter[status]": "APPROVED" });
    expect(orders.validate({ q: "  lan  ", pageSize: "50" })).toEqual({ q: "lan", pageSize: "50" });
  });

  it("review item 3: a page past the server's bound normalises instead of failing every request", () => {
    expect(orders.parse({ page: String(LIST_MAX_PAGE) }).page).toBe(LIST_MAX_PAGE);
    expect(orders.parse({ page: String(LIST_MAX_PAGE + 1) }).page).toBe(1);
    expect(orders.validate({ page: "999999999" })).toEqual({});
  });

  it("review item 4: filter values the list does not know are dropped from the URL", () => {
    expect(orders.validate({ "filter[status]": "APPROVED,BOGUS,approved" })).toEqual({ "filter[status]": "APPROVED" });
    expect(orders.validate({ "filter[status]": "BOGUS" })).toEqual({});
    expect(orders.validate({ "filter[network]": "shopee" })).toEqual({ "filter[network]": "shopee" });
  });

  it("review item 9: the server and the client share the value and sort rules", () => {
    expect(splitFilterValues(["A,B", " B ", ""])).toEqual(["A", "B"]);
    expect(parseSortParam("cashback:desc", ["cashback"])).toEqual({ field: "cashback", direction: "desc" });
    expect(parseSortParam("cashback:desc:x", ["cashback"])).toBeNull();
    expect(parseSortParam("product:asc", ["cashback"])).toBeNull();
  });

  it("sends the full query to the API, page size included (LC-5)", () => {
    expect(listQueryString(orders, orders.defaults)).toBe("pageSize=25");
    expect(listQueryString(orders, { ...orders.defaults, q: "a%b", page: 2 })).toBe("q=a%25b&page=2&pageSize=25");
  });

  it("refuses a spec whose default sort is not sortable", () => {
    expect(() => listSearch({ sortable: ["a"], filters: [], defaultSort: { field: "b", direction: "asc" } })).toThrow(/not sortable/);
  });
});
