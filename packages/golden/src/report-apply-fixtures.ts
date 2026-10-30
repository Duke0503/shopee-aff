/**
 * Report apply fixtures (AD-5, AD-8, NFR-1): the cashback, fee, tax and withheld setting an order
 * stores when a report row approves it, per network and settlement period mark (FR-13, D54), and
 * what a repeated report writes (the fingerprint skip). The server's orders module runs them
 * against a migrated ledger (apps/server/tests/report-apply.test.ts); this package only holds the data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface ApprovalCase {
  name: string;
  story: string;
  network: "shopee" | "accesstrade";
  estimatedCommission: number;
  /** The approved item's commission parts (Shopee: its own part and the XTRA part). */
  approvedParts: number[];
  /** Staff's mark on the approval month before the approval; null for none. */
  periodMark: boolean | null;
  guest: boolean;
  expected: { approvedCommission: number; fee: number; tax: number; withheld: boolean; cashback: number };
}

export type FixtureStatus = "AWAITING" | "APPROVED" | "CANCELLED" | "UNKNOWN";

export interface RepeatRow {
  orderStatus: FixtureStatus | null;
  items: { status: FixtureStatus; parts: number[] }[];
}

export interface RepeatCase {
  name: string;
  story: string;
  rows: RepeatRow[];
  expected: { outcomes: string[]; status: string; observations: number; history: number; outbox: number };
}

export interface ReportApplyFixtureFile {
  rule: "applyReportRow";
  source: string;
  approvals: ApprovalCase[];
  repeats: RepeatCase[];
}

export const REPORT_APPLY_FIXTURE = fileURLToPath(new URL("../fixtures/orders/report-apply.json", import.meta.url));

export function loadReportApplyFixtures(path: string = REPORT_APPLY_FIXTURE): ReportApplyFixtureFile {
  return JSON.parse(readFileSync(path, "utf8")) as ReportApplyFixtureFile;
}
