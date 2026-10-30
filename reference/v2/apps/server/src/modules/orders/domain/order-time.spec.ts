import { describe, expect, it } from "vitest";

import { parseOrderTime } from "./order-time";

describe("parseOrderTime", () => {
  it("reads an epoch in seconds or milliseconds as VN local time", () => {
    expect(parseOrderTime("1000000000")).toBe("2001-09-09T08:46:40");
    expect(parseOrderTime("1000000000000")).toBe("2001-09-09T08:46:40");
  });

  it("keeps a naive timestamp and shifts an absolute one to VN", () => {
    expect(parseOrderTime("2026-09-24T14:35:54")).toBe("2026-09-24T14:35:54");
    expect(parseOrderTime("2026-09-24 14:35:54")).toBe("2026-09-24T14:35:54");
    expect(parseOrderTime("2026-09-24T14:35:54+07:00")).toBe("2026-09-24T14:35:54");
    expect(parseOrderTime("2026-09-24T07:35:54Z")).toBe("2026-09-24T14:35:54");
  });

  it("understands the day-first and slash formats", () => {
    expect(parseOrderTime("24/09/2026 14:35:54")).toBe("2026-09-24T14:35:54");
    expect(parseOrderTime("24-09-2026 14:35:54")).toBe("2026-09-24T14:35:54");
    expect(parseOrderTime("2026/09/24 14:35:54")).toBe("2026-09-24T14:35:54");
    expect(parseOrderTime("2026-09-24")).toBe("2026-09-24T00:00:00");
  });

  it("falls back to the order SN date, then to now", () => {
    expect(parseOrderTime("", "260911ABCD")).toBe("2026-09-11T00:00:00");
    expect(parseOrderTime(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(parseOrderTime("not a date")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});
