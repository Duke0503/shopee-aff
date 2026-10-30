import Database from "better-sqlite3";
import { LIKE_ESCAPE, searchPattern, searchText, sortKey } from "@cashback/core";
import { describe, expect, it } from "vitest";

/** The text functions as a list query uses them: stored columns, `LIKE ... ESCAPE`, `ORDER BY sort_key`. */
function people(names: string[]): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE people (name TEXT NOT NULL, search_text TEXT NOT NULL, sort_key TEXT NOT NULL)");
  const insert = sqlite.prepare("INSERT INTO people VALUES (?, ?, ?)");
  for (const name of names) insert.run(name, searchText(name), sortKey(name));
  return sqlite;
}

function search(sqlite: Database.Database, query: string): string[] {
  return (sqlite.prepare(`SELECT name FROM people WHERE search_text LIKE ? ESCAPE '${LIKE_ESCAPE}' ORDER BY sort_key`).all(searchPattern(query)) as { name: string }[]).map((r) => r.name);
}

describe("search_text and sort_key in SQLite (Story 1.9)", () => {
  it("AC1: 'nguyen thi dao' finds 'Nguyễn Thị Đào'", () => {
    expect(search(people(["Nguyễn Thị Đào", "Trần Văn An"]), "nguyen thi dao")).toEqual(["Nguyễn Thị Đào"]);
  });

  it("AC2: % and _ in a query match only themselves", () => {
    const sqlite = people(["giam 100%", "giam 1000", "a_b", "axb"]);
    expect(search(sqlite, "100%")).toEqual(["giam 100%"]);
    expect(search(sqlite, "a_b")).toEqual(["a_b"]);
    expect(search(sqlite, "%")).toEqual(["giam 100%"]);
  });

  it("AC3: ORDER BY sort_key gives the Vietnamese order", () => {
    const sqlite = people(["Đào", "Dung", "An", "Ánh"]);
    expect((sqlite.prepare("SELECT name FROM people ORDER BY sort_key").all() as { name: string }[]).map((r) => r.name)).toEqual(["An", "Ánh", "Dung", "Đào"]);
  });
});
