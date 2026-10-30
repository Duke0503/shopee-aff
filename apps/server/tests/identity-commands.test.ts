/**
 * Story 2.2, review follow-up: `resolveCustomer` returns only a surviving customer, in a fixed
 * precedence, and `issueCustomerCode` skips every code already taken, warning which.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { issueCustomerCode, resolveCustomer } from "../src/modules/identity/index";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { auditBy, tempDir, TEST_CLOCK } from "./helpers/live-fixture";

function freshLedger(seed: string): Ledger {
  const ledger = openLedger(join(tempDir("cashback-identity-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), TEST_CLOCK);
  ledger.sqlite.exec(seed);
  return ledger;
}

const PEOPLE = `
INSERT INTO customers (customer_id, customer_code, role, status, zalo_user_id) VALUES
  ('A1', 'DP00001', 'USER', 'ACTIVE', 'ZA1'),
  ('B2', 'DP00002', 'USER', 'DISABLED', 'A1'),
  ('OLD3', 'DP00003', 'USER', 'MERGED', 'ZOLD3'),
  ('MID4', NULL, 'USER', 'MERGED', NULL),
  ('E5', 'DP00005', 'USER', 'ERASED', NULL),
  ('M6', NULL, 'USER', 'MERGED', NULL),
  ('HOUSE', NULL, 'HOUSE', 'ACTIVE', NULL),
  ('ZALOKEY', NULL, 'USER', 'ACTIVE', 'DP00007');
INSERT INTO customer_aliases (alias, customer_id) VALUES
  ('OLD3', 'MID4'), ('MID4', 'A1'), ('DP00009', 'A1'), ('ZKEY', 'B2'), ('DP00007', 'A1');
INSERT INTO customer_code_counter (id, last) VALUES (1, 5);
`;

describe("resolveCustomer (review item 2)", () => {
  const ledger = freshLedger(PEOPLE);
  const resolve = (key: string) => ledger.tx((db) => resolveCustomer(db, key));

  it("returns the customer with its role and status", () => {
    expect(resolve("A1")).toEqual({ customerId: "A1", role: "USER", status: "ACTIVE" });
    expect(resolve("HOUSE")).toEqual({ customerId: "HOUSE", role: "HOUSE", status: "ACTIVE" });
    expect(resolve("DP00002")).toEqual({ customerId: "B2", role: "USER", status: "DISABLED" });
  });

  it("precedence: customer_id over another row's zalo_user_id", () => {
    // 'A1' is A1's id and B2's Zalo id.
    expect(resolve("A1")?.customerId).toBe("A1");
  });

  it("precedence: customer_code over alias, alias over zalo_user_id", () => {
    // 'DP00007' is an alias of A1 and ZALOKEY's Zalo id: the alias wins.
    expect(resolve("DP00007")?.customerId).toBe("A1");
    expect(resolve("dp00001")?.customerId).toBe("A1");
    expect(resolve("ZKEY")?.customerId).toBe("B2");
    expect(resolve("ZA1")?.customerId).toBe("A1");
  });

  it("a MERGED row resolves through its aliases to the survivor, across a chain", () => {
    expect(resolve("OLD3")?.customerId).toBe("A1");
    expect(resolve("DP00003")?.customerId).toBe("A1");
    expect(resolve("ZOLD3")?.customerId).toBe("A1");
  });

  it("an ERASED row, a merged row with no survivor, and unknown or blank keys resolve to null", () => {
    expect(resolve("E5")).toBeNull();
    expect(resolve("DP00005")).toBeNull();
    expect(resolve("M6")).toBeNull();
    expect(resolve("NOBODY")).toBeNull();
    expect(resolve("   ")).toBeNull();
  });
});

describe("issueCustomerCode (review item 6)", () => {
  function issuing(seed: string) {
    const ledger = freshLedger(seed);
    const warnings: unknown[] = [];
    const logger = { warn: (fields: unknown) => void warnings.push(fields) };
    return { ledger, warnings, issue: () => ledger.tx((db) => issueCustomerCode(db, logger, auditBy(db))) };
  }

  it("issues the next free code without a warning", () => {
    const { issue, warnings, ledger } = issuing(PEOPLE);
    expect(issue()).toBe("DP00006");
    expect(warnings).toEqual([]);
    expect(ledger.sqlite.prepare("SELECT last FROM customer_code_counter").get()).toEqual({ last: 6 });
  });

  it("skips past every taken code, customer or alias, in the same transaction, and names them", () => {
    const { issue, warnings, ledger } = issuing(`${PEOPLE}
      INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('G8', 'DP00008', 'USER', 'ACTIVE');
      UPDATE customer_code_counter SET last = 6;`);
    // DP00007 is an alias, DP00008 a customer, DP00009 an alias: the gap is jumped.
    expect(issue()).toBe("DP00010");
    expect(warnings).toEqual([{ skipped: ["DP00007", "DP00008", "DP00009"] }]);
    expect(ledger.sqlite.prepare("SELECT last FROM customer_code_counter").get()).toEqual({ last: 10 });
    expect(issue()).toBe("DP00011");
  });
});
