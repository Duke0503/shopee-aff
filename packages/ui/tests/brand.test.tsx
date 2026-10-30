import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CodeChip, formatCount, formatMoney, MoneyFigure, moneyAriaLabel, statusLabel, StatusBadge, uiText } from "../src/index";

const SIGN = uiText("money_sign");

describe("UX-DR3 money figure: one formatter, estimate variant, dash for missing, read in words", () => {
  it("formats whole dong with dots and the sign from the label file, no space", () => {
    expect(formatMoney(79216)).toBe(`79.216${SIGN}`);
    expect(formatMoney(12345678)).toBe(`12.345.678${SIGN}`);
    expect(formatMoney(0)).toBe(`0${SIGN}`);
    expect(formatMoney(-9263)).toBe(`−9.263${SIGN}`);
    expect(formatCount(1284)).toBe("1.284");
    expect(moneyAriaLabel(79216)).toBe(uiText("money_aria", { amount: "79.216" }));
  });

  it("refuses an amount that is not a whole dong integer instead of rounding it", () => {
    expect(formatMoney(79216.5)).toBeNull();
    expect(formatMoney(Number.NaN)).toBeNull();
  });

  it("renders the dash for a missing amount, never a zero amount", () => {
    render(<MoneyFigure amount={null} />);
    expect(screen.getByLabelText(uiText("value_missing_aria"))).toHaveTextContent("–");
    expect(screen.queryByText(`0${SIGN}`)).toBeNull();
  });

  it("marks an estimate with the about prefix and the estimate tag", () => {
    render(<MoneyFigure amount={9263} estimate />);
    const about = uiText("money_about");
    expect(screen.getByLabelText(`${about} ${uiText("money_aria", { amount: "9.263" })}`)).toHaveTextContent(`${about} 9.263${SIGN}`);
    expect(screen.getByText(uiText("money_estimate_tag"))).toBeInTheDocument();
  });
});

describe("UX-DR3 status badge: label and tone from the registry", () => {
  it("shows the registry label with its tone and a text, never colour alone", () => {
    render(<StatusBadge entity="order" value="PAID" />);
    expect(screen.getByText(statusLabel("status_paid")).parentElement).toHaveAttribute("data-tone", "done");
  });
});

describe("Code chip: one component, copy on tap, confirmed for two seconds", () => {
  const copyName = uiText("code_copy", { code: "DP00012" });

  it("copies the code and confirms it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CodeChip code="DP00012" />);
    await user.click(screen.getByRole("button", { name: copyName }));
    expect(writeText).toHaveBeenCalledWith("DP00012");
    expect(screen.getByRole("status")).toHaveTextContent(uiText("code_copied"));
  });

  it("clears the confirmation after two seconds", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.resolve() } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<CodeChip code="DP00012" />);
    await act(async () => screen.getByRole("button", { name: copyName }).click());
    expect(screen.getByRole("status")).toHaveTextContent(uiText("code_copied"));
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status")).toHaveTextContent("");
    vi.useRealTimers();
  });

  it("truncates a long code instead of widening its column", () => {
    render(<CodeChip code="ORDER-2610300000123456789" />);
    expect(screen.getByText("ORDER-2610300000123456789")).toHaveClass("truncate");
    expect(screen.getByRole("button")).toHaveClass("max-w-full", "min-w-0");
  });
});

describe("status badge never cuts its label (Sprint 18 review)", () => {
  it("a long label wraps to another line inside a narrow column instead of an ellipsis", () => {
    const { container } = render(<StatusBadge entity="order" value="REJECTED" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain("whitespace-normal");
    expect(badge.className).not.toMatch(/(^|\s)h-\[22px\]/);
    expect(container.querySelector(".truncate")).toBeNull();
    expect(badge).toHaveTextContent(statusLabel("status_rejected"));
  });
});
