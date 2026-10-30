import { describe, expect, it } from "vitest";
import {
  decideRequestLink,
  type ExistingRequest,
  type RequestLinkInput,
} from "./request-link.use-case";

const NOW = "2026-10-07T12:00:00";
const URL_A = "https://shopee.vn/x-i.1.2";

const input = (over: Partial<RequestLinkInput> = {}): RequestLinkInput => ({
  sourceUrls: [URL_A],
  customerId: "C1",
  attributionDays: 7,
  nowIso: NOW,
  ...over,
});

const request = (over: Partial<ExistingRequest> & { requestId: string }): ExistingRequest => ({
  customerId: "C1",
  sourceUrl: URL_A,
  status: "pending",
  createdAt: "2026-10-05T12:00:00",
  ...over,
});

const supported = (url: string): string | null => (url.includes("shopee.vn") ? "shopee" : null);

describe("decideRequestLink", () => {
  it("reuses the customer's own recent link for the same product", () => {
    expect(decideRequestLink(input(), [request({ requestId: "R1" })], supported)).toEqual({
      kind: "reuse",
      requestId: "R1",
    });
  });

  it("makes a new request once the window has passed", () => {
    const old = request({ requestId: "R1", createdAt: "2026-09-01T12:00:00" });
    expect(decideRequestLink(input(), [old], supported)).toEqual({ kind: "new", platform: "shopee" });
  });

  it("NEVER reuses another customer's link", () => {
    const other = request({ requestId: "R1", customerId: "C2" });
    expect(decideRequestLink(input(), [other], supported)).toEqual({ kind: "new", platform: "shopee" });
  });

  it("never reuses a failed request", () => {
    const failed = request({ requestId: "R1", status: "failed" });
    expect(decideRequestLink(input(), [failed], supported).kind).toBe("new");
  });

  it("matches the product across its spellings", () => {
    const stored = request({ requestId: "R1" });
    const withRawAndClean = input({ sourceUrls: ["raw text paste", URL_A] });
    expect(decideRequestLink(withRawAndClean, [stored], supported)).toEqual({
      kind: "reuse",
      requestId: "R1",
    });
  });

  it("reports an unsupported link", () => {
    expect(decideRequestLink(input({ sourceUrls: ["https://example.com/x"] }), [], supported)).toEqual(
      { kind: "unsupported" },
    );
  });
});
