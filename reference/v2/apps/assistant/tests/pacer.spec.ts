import { describe, expect, it } from "vitest";
import { GroupPacer } from "../src/pacer";

const GAP = 1200;

describe("GroupPacer", () => {
  it("does not delay the first message to a key", () => {
    expect(new GroupPacer(GAP).delayFor("g1", 1000)).toBe(0);
  });

  it("waits the full gap right after a send", () => {
    const pacer = new GroupPacer(GAP);
    pacer.mark("g1", 1000);
    expect(pacer.delayFor("g1", 1000)).toBe(GAP);
  });

  it("waits only the remainder once part of the gap has passed", () => {
    const pacer = new GroupPacer(GAP);
    pacer.mark("g1", 1000);
    expect(pacer.delayFor("g1", 1500)).toBe(700);
    expect(pacer.delayFor("g1", 2200)).toBe(0);
  });

  it("keeps keys independent", () => {
    const pacer = new GroupPacer(GAP);
    pacer.mark("g1", 1000);
    expect(pacer.delayFor("g2", 1000)).toBe(0);
  });
});
