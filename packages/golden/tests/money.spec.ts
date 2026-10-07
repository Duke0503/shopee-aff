import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFixtureFile, runCase } from "../src/runner";

const fixturesDir = fileURLToPath(new URL("../fixtures/money", import.meta.url));
const files = readdirSync(fixturesDir).filter((file) => file.endsWith(".json"));

describe("money golden fixtures (must match Python to the dong)", () => {
  for (const file of files) {
    const fixture = loadFixtureFile(join(fixturesDir, file));
    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, () => {
          expect(runCase(fixture, testCase)).toEqual(testCase.expected);
        });
      }
    });
  }
});
