/**
 * Story 1.11: every network fixture in packages/golden/fixtures/networks runs through the
 * linking module's readers and status maps and the orders module's report signal, both
 * reached through their index.ts. Real anonymised rows run exactly like synthetic ones.
 */
import { loadNetworkFixtures, type NetworkCase, type NetworkFixtureFile } from "@cashback/golden/networks";
import { describe, expect, it } from "vitest";

import {
  mapAccessTradeLine,
  mapExportStatus,
  mapStatus,
  readAccessTradeTransactions,
  readExportAmount,
  readShopeeConversion,
  SHOPEE_STATUS_MAP,
  type ReportRow,
  type RowProblem,
} from "../src/modules/linking/index";
import { reportSignal } from "../src/modules/orders/index";

const files = loadNetworkFixtures();

function project(rows: ReportRow[]) {
  return {
    rows: rows.map((row) => ({
      orderId: row.orderId,
      orderStatus: row.orderStatus,
      items: row.items.map((item) => ({ status: item.status, commissionParts: item.commissionParts, value: item.value })),
      subIds: row.subIds,
      signal: reportSignal(row),
    })),
  };
}

function run(file: NetworkFixtureFile, c: NetworkCase): unknown {
  const input = c.input;
  switch (file.rule) {
    case "statusMap":
      return mapStatus(SHOPEE_STATUS_MAP, input["raw"]);
    case "accesstradeLine":
      return mapAccessTradeLine(input["status"], input["is_confirmed"]);
    case "shopeeConversion":
      return project(readShopeeConversion(input));
    case "accesstradeTransactions":
      return project(readAccessTradeTransactions(input["lines"] as unknown[]));
    case "shopeeExportStatus":
      return mapExportStatus(String(input["raw"]));
    case "shopeeExportAmount": {
      const problems: RowProblem[] = [];
      const amount = readExportAmount(String(input["text"]), problems);
      return problems.length > 0 ? problems[0] : amount;
    }
  }
}

describe("network golden fixtures (Story 1.11, D38)", () => {
  for (const file of files) {
    describe(file.file, () => {
      for (const c of file.cases) {
        it(`${c.story ?? ""} [${c.provenance}] ${c.name}`, () => {
          expect(run(file, c)).toEqual(c.expected);
        });
      }
    });
  }

  it("AC1: no UNPAID, PAID, COMPLETED or DELIVERED fixture is ever CANCELLED or a cancel", () => {
    const awaiting = /^(unpaid|paid|completed|delivered)$/i;
    for (const file of files.filter((f) => f.network === "shopee")) {
      for (const c of file.cases) {
        if (file.rule === "statusMap" && awaiting.test(String(c.input["raw"]))) expect(c.expected).toBe("AWAITING");
      }
    }
    for (const status of ["UNPAID", "PAID", "COMPLETED", "DELIVERED"]) {
      const [row] = readShopeeConversion({ orders: [{ order_sn: "X1", order_status: status, items: [{ display_item_status: "", item_commission: 100_000 }] }] });
      expect(row?.orderStatus).toBe("AWAITING");
      expect(reportSignal(row as ReportRow)).toEqual({ kind: "AWAITING", liveItems: [0] });
    }
  });

  const real = files.flatMap((f) => f.cases).filter((c) => c.provenance === "real-anonymised");
  if (real.length === 0) {
    it.todo("AC1-AC3 on real anonymised report rows: open until the owner adds rows to packages/golden/fixtures/networks (see its README)");
  } else {
    it(`AC1-AC3: ${real.length} real anonymised rows are part of the run above`, () => {
      expect(real.length).toBeGreaterThan(0);
    });
  }
});
