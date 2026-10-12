import { describe, expect, it } from "vitest";

import bundled from "../../../resources/dashboard.vi.json";
import { label, type Labels } from "../src/shared/lib/labels";
import { platformText, roleText, settlementText, statusText } from "../src/shared/lib/status";

const labels = bundled as Labels;

describe("label", () => {
  it("fills the placeholders the label file uses", () => {
    expect(label(labels, "admin_page_of", { page: 2, total: 5 })).toBe("Trang 2/5");
  });

  it("leaves a placeholder the caller did not send", () => {
    expect(label(labels, "admin_page_of", { total: 5 })).toBe("Trang {page}/5");
  });

  it("reads a key the live file dropped from the copy bundled at build time", () => {
    expect(label({}, "logout")).toBe("Đăng xuất");
  });
});

describe("statusText", () => {
  it("names the states the owner knows", () => {
    expect(statusText(labels, "approved")).toBe("Đã duyệt");
    expect(statusText(labels, "paid")).toBe("Đã chuyển tiền");
  });

  it("shows an unknown state as the server sent it", () => {
    expect(statusText(labels, "brand_new_state")).toBe("brand_new_state");
  });
});

describe("the other words the order list needs", () => {
  it("names the marketplace an order came from", () => {
    expect(platformText(labels, "shopee")).toBe("Shopee");
    expect(platformText(labels, "tiktok")).toBe("TikTok");
    expect(platformText(labels, "lazada")).toBe("lazada");
  });

  it("says whether the marketplace has paid us yet", () => {
    expect(settlementText(labels, "unsettled")).toBe("Chưa đối soát");
    expect(settlementText(labels, "settled")).toBe("Đã đối soát");
    expect(settlementText(labels, "who_knows")).toBe("who_knows");
  });

  it("names who a row is", () => {
    expect(roleText(labels, "admin")).toBe("Chủ");
    expect(roleText(labels, "employee")).toBe("Nhân viên");
  });
});
