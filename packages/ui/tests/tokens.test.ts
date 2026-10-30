import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const DESIGN = read("../../../_bmad-output/planning-artifacts/ux-designs/ux-cashback-2026-10-30/DESIGN.md");
const TOKENS = read("../src/styles/tokens.css");
const GLOBALS = read("../src/styles/globals.css");

/** The flat `key: value` entries of one top-level section of DESIGN.md's front matter. */
function section(name: string): Map<string, string> {
  const front = DESIGN.split(/^---\s*$/m)[1] ?? "";
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `${name}:`);
  const entries = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([a-z0-9-]+): '?([^']+?)'?\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) entries.set(m[1], m[2]);
  }
  return entries;
}

function cssVariables(css: string): Map<string, string> {
  return new Map([...css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
}

describe("Story 4.4 UX-DR1: the tokens are the DESIGN.md values, generated once into packages/ui", () => {
  const css = cssVariables(TOKENS);

  it("defines every DESIGN.md colour with the same hex value", () => {
    const colors = section("colors");
    expect(colors.size).toBeGreaterThan(40);
    expect(colors.get("primary")).toBe("#047857");
    expect(colors.get("brand-mark")).toBe("#059669");
    for (const [name, value] of colors) expect([name, css.get(name)?.toUpperCase()]).toEqual([name, value.toUpperCase()]);
  });

  it("defines every DESIGN.md radius and spacing token with the same value", () => {
    for (const [name, value] of section("rounded")) expect([name, css.get(`rounded-${name}`)]).toEqual([name, value]);
    for (const [name, value] of section("spacing")) expect([name, css.get(name)]).toEqual([name, value]);
  });

  it("uses Be Vietnam Pro with the fallback stack DESIGN.md names", () => {
    expect(DESIGN).toContain("fontFamily: \"'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif\"");
    expect(css.get("font-family")).toBe("'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif");
  });

  it("maps every token onto a Tailwind theme colour the components can use", () => {
    const theme = cssVariables(GLOBALS);
    for (const name of section("colors").keys()) {
      if (name.startsWith("chart-")) continue;
      expect([name, theme.get(`color-${name}`)]).toEqual([name, `var(--${name})`]);
    }
  });
});
