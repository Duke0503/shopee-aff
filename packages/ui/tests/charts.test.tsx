/**
 * Story 4.17: the hand-built charts of the Overview (dataviz rules): one axis, the last value
 * labelled, every value on keyboard focus and in the table view, a part of 0 drawn as nothing; and
 * the ratio formatters, which only place the server's digits.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarChart, formatBps, formatBpsChange, formatCompactMoney, formatSignedMoney, SegmentedBar } from "../src/index";

const points = [
  { key: "w1", label: "05/10", name: "Week 05/10", value: 12000 },
  { key: "w2", label: "12/10", name: "Week 12/10", value: -3000 },
  { key: "w3", label: "19/10", name: "Week 19/10", value: 28016 },
];
const money = (v: number) => `${v} d`;

describe("BarChart", () => {
  it("draws one bar per point on one axis and labels only the last value", () => {
    const { container } = render(<BarChart points={points} formatValue={money} formatTick={String} title="Profit" columnHeader="Week" valueHeader="Profit" />);
    expect(container.querySelectorAll("path").length).toBe(3);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("28016 d");
    expect(texts).not.toContain("12000 d");
    expect(screen.getByRole("img", { name: "Profit" })).toBeTruthy();
  });

  it("shows the value and the bar's name on keyboard focus, and every value in the table view", () => {
    render(<BarChart points={points} formatValue={money} formatTick={String} title="Profit" columnHeader="Week" valueHeader="Profit" />);
    fireEvent.focus(screen.getByRole("button", { name: "Week 05/10: 12000 d" }));
    const tip = screen.getByRole("tooltip");
    expect(within(tip).getByText("12000 d")).toBeTruthy();
    expect(within(tip).getByText("Week 05/10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("-3000 d")).toBeTruthy();
  });
});

describe("SegmentedBar", () => {
  it("draws nothing for a part of 0 and names every part for screen readers", () => {
    render(
      <SegmentedBar
        label="Where the money went"
        segments={[
          { key: "a", name: "Profit", value: 28016, colorClass: "bg-chart-1", inside: "12,8%", readout: "Profit 28.016" },
          { key: "b", name: "Bonus", value: 0, colorClass: "bg-chart-3", inside: "0%", readout: "Bonus 0" },
          { key: "c", name: "Cashback", value: 128189, colorClass: "bg-chart-2", inside: "58,5%", readout: "Cashback 128.189" },
        ]}
      />,
    );
    const bar = screen.getByRole("img", { name: "Where the money went" });
    expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Profit 28.016", "Cashback 128.189"]);
  });
});

describe("ratio formatters", () => {
  it("write the server's basis points exactly, with a decimal comma and a true minus", () => {
    expect(formatBps(1780)).toBe("17,8%");
    expect(formatBps(2727)).toBe("27,27%");
    expect(formatBps(10000)).toBe("100%");
    expect(formatBps(-2020)).toBe("\u221220,2%");
    expect(formatBps(null)).toBeNull();
    expect(formatBpsChange(450)).toBe("+4,5 \u0111i\u1ec3m");
    expect(formatSignedMoney(-10098)).toBe("\u221210.098\u0111");
    expect(formatSignedMoney(7067)).toBe("+7.067\u0111");
    expect(formatCompactMoney(9000)).toBe("9.000");
    expect(formatCompactMoney(250000)).toBe("250k");
    expect(formatCompactMoney(1250000)).toBe("1,2tr");
    expect(formatCompactMoney(-50000)).toBe("\u221250k");
  });
});
