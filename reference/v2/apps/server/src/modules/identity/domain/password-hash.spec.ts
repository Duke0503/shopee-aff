import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hashPassword, hashSessionToken, verifyPassword } from "./password-hash";

interface GoldenCase {
  name: string;
  input: Record<string, string>;
  expected: Record<string, unknown>;
}

const FIXTURE = fileURLToPath(
  new URL(
    "../../../../../../packages/golden/fixtures/identity/password-hash.json",
    import.meta.url,
  ),
);
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: GoldenCase[] };

describe("password hash cross-compatibility with Python", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const { password, salt, token } = testCase.input;
      if (password) {
        const stored = hashPassword(password, salt);
        expect(stored).toBe(testCase.expected.stored);
        expect(verifyPassword(password, stored)).toBe(true);
        expect(verifyPassword("WRONGPASS", stored)).toBe(false);
      } else if (token) {
        expect(hashSessionToken(token)).toBe(testCase.expected.hash);
      } else {
        throw new Error(`unhandled golden case: ${testCase.name}`);
      }
    });
  }
});
