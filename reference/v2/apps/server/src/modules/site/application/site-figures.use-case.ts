import { roundDong, WITHHOLDING_TAX_RATE } from "@mmo/money";

import { formatVnd, render, type Messages } from "../../../notifications";

/**
 * The handful of numbers the public pages quote. They come from the same two
 * constants the bot's greeting uses, and a percentage is shown rather than a
 * figure nobody can price in their head. Ports `web/dashboard.py::site_figures`.
 */
const EXAMPLE_ORDER_VND = 200_000;
const EXAMPLE_RATE = 0.08;

export interface SiteFigures {
  rate: string;
  reduced: string;
  days: string;
  example_order: string;
  example_commission: string;
  example_cashback: string;
}

export interface SiteOptions {
  cashbackRate: number;
  taxPolicy: string;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export function siteFigures(messages: Messages, options: SiteOptions): SiteFigures {
  const reducedRate =
    options.taxPolicy === "user_absorbs"
      ? options.cashbackRate - WITHHOLDING_TAX_RATE
      : options.cashbackRate;
  const exampleCashback = EXAMPLE_ORDER_VND * EXAMPLE_RATE * options.cashbackRate;

  return {
    rate: percent(options.cashbackRate),
    reduced: percent(reducedRate),
    days: render(messages, "payout_window"),
    example_order: formatVnd(messages, EXAMPLE_ORDER_VND),
    example_commission: percent(EXAMPLE_RATE),
    example_cashback: formatVnd(messages, roundDong(exampleCashback)),
  };
}
