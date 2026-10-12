import { afterEach, describe, expect, it } from "vitest";

import { publicBaseUrl, publicUrl } from "./public-base-url";

const ORIGINAL = process.env.PUBLIC_BASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = ORIGINAL;
});

describe("publicBaseUrl", () => {
  it("defaults to the live site when the environment says nothing", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(publicBaseUrl()).toBe("https://hoantiendp.com");
  });

  it("strips trailing slashes, so a link never doubles one", () => {
    process.env.PUBLIC_BASE_URL = "https://example.test/";
    expect(publicBaseUrl()).toBe("https://example.test");
  });

  it("allows an empty value, which means relative links", () => {
    process.env.PUBLIC_BASE_URL = "  ";
    expect(publicBaseUrl()).toBe("");
  });
});

describe("publicUrl", () => {
  it("makes a path absolute", () => {
    process.env.PUBLIC_BASE_URL = "https://example.test/";
    expect(publicUrl("/b/tok-abc")).toBe("https://example.test/b/tok-abc");
    expect(publicUrl("b/tok-abc")).toBe("https://example.test/b/tok-abc");
  });

  it("leaves the path alone when there is no base", () => {
    process.env.PUBLIC_BASE_URL = "";
    expect(publicUrl("/b/tok-abc")).toBe("/b/tok-abc");
  });
});
