import { describe, expect, it } from "vitest";

import type { Messages } from "../../../notifications";
import { siteFigures } from "./site-figures.use-case";

const MESSAGES: Messages = {
  payout_window: "a window",
  thousands_separator: ".",
  currency: "",
};

describe("siteFigures", () => {
  it("advertises the full rate when the owner absorbs the tax", () => {
    const figures = siteFigures(MESSAGES, { cashbackRate: 0.8, taxPolicy: "owner_absorbs" });
    expect(figures).toEqual({
      rate: "80%",
      reduced: "80%",
      days: "a window",
      example_order: "200.000",
      example_commission: "8%",
      example_cashback: "12.800",
    });
  });

  it("shows the ten-points-lower rate when the customer absorbs it", () => {
    expect(siteFigures(MESSAGES, { cashbackRate: 0.8, taxPolicy: "user_absorbs" })).toMatchObject({
      rate: "80%",
      reduced: "70%",
      example_cashback: "12.800",
    });
  });
});
