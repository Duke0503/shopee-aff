import { describe, expect, it } from "vitest";

import { matchesSearch, searchPattern, searchText, sortKey, LIKE_ESCAPE } from "../src/index";

describe("search_text (Story 1.9, AD-12, list-defects root cause 7)", () => {
  it("AC1: folds 'Nguyễn Thị Đào' to 'nguyenthidao' and the query 'nguyen thi dao' matches it", () => {
    const stored = searchText("Nguyễn Thị Đào");
    expect(stored).toBe("nguyenthidao");
    expect(matchesSearch(stored, "nguyen thi dao")).toBe(true);
    expect(matchesSearch(stored, "THỊ đào")).toBe(true);
    expect(matchesSearch(stored, "nguyen van")).toBe(false);
  });

  it("folds every Vietnamese vowel mark and both cases of d-stroke", () => {
    expect(searchText("ĂÂÊÔƠƯ ăâêôơư đĐ")).toBe("aaeoouaaeooudd");
    expect(searchText("Hoà Hòa Huỳnh Phượng")).toBe("hoahoahuynhphuong");
  });

  it("joins several fields so one search_text covers a row, without matching across fields", () => {
    const stored = searchText("Trần An", "DP00012", null, undefined);
    expect(matchesSearch(stored, "dp00012")).toBe(true);
    expect(matchesSearch(stored, "tran an")).toBe(true);
    expect(matchesSearch(stored, "andp")).toBe(false);
  });

  it("AC2: escapes % and _ so they match only themselves", () => {
    expect(searchPattern("50%_off")).toBe(`%50${LIKE_ESCAPE}%${LIKE_ESCAPE}_off%`);
    expect(searchPattern("a\\b")).toBe(`%a${LIKE_ESCAPE}${LIKE_ESCAPE}b%`);
    expect(matchesSearch(searchText("100%"), "100%")).toBe(true);
    expect(matchesSearch(searchText("1000"), "10%")).toBe(false);
    expect(matchesSearch(searchText("a_b"), "a_b")).toBe(true);
    expect(matchesSearch(searchText("axb"), "a_b")).toBe(false);
  });

  it("treats an empty or blank query as no search", () => {
    expect(searchPattern("   ")).toBeNull();
    expect(matchesSearch("anything", " ")).toBe(true);
  });

  it("AC4: refuses structured input by type, so raw JSON cannot be indexed", () => {
    // @ts-expect-error an object is not text
    expect(() => searchText({ name: "An" })).toThrow(TypeError);
    // @ts-expect-error an array is not text
    expect(() => searchText(["An", "Dung"])).toThrow(TypeError);
    // @ts-expect-error a number is not text
    expect(() => searchText(42)).toThrow(TypeError);
  });

  it("accepts any text, including text that looks like JSON", () => {
    expect(searchText("[2024]")).toBe("[2024]");
    expect(searchText("{}")).toBe("{}");
  });
});

describe("sort_key (Story 1.9, Vietnamese collation)", () => {
  const byKey = (names: string[]): string[] => [...names].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  it("AC3: sorts 'Đào', 'Dung', 'An', 'Ánh' in Vietnamese order", () => {
    expect(byKey(["Đào", "Dung", "An", "Ánh"])).toEqual(["An", "Ánh", "Dung", "Đào"]);
  });

  it("orders the letters a, ă, â and d, đ and o, ô, ơ as separate letters", () => {
    expect(byKey(["Âu", "Ăn", "Anh", "Ân", "Bảo"])).toEqual(["Anh", "Ăn", "Ân", "Âu", "Bảo"]);
    expect(byKey(["Đức", "Duy", "Dũng"])).toEqual(["Dũng", "Duy", "Đức"]);
    expect(byKey(["Ơn", "Ông", "Oanh"])).toEqual(["Oanh", "Ông", "Ơn"]);
  });

  it("breaks ties by tone: level, grave, hook, tilde, acute, dot below", () => {
    expect(byKey(["mạ", "má", "mã", "mả", "mà", "ma"])).toEqual(["ma", "mà", "mả", "mã", "má", "mạ"]);
  });

  it("ignores case and puts a shorter name before its extension", () => {
    expect(sortKey("an")).toBe(sortKey("AN"));
    expect(byKey(["An Bình", "An", "Anh"])).toEqual(["An", "An Bình", "Anh"]);
  });

  it("builds an ASCII key, so SQLite's binary collation gives the same order", () => {
    expect(sortKey("Nguyễn Thị Đào")).toMatch(/^[\x20-\x7e]*$/);
  });
});
