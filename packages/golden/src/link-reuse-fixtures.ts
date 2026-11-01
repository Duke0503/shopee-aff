/**
 * Link reuse fixtures (FR-5, D5, D6, D23, INV-1; Story 5.2): existing link requests, one new
 * request, and whether the rule must hand an existing request back or make a new one for the
 * requester. The first case is the production defect of 2026-09-25, where a link reused by product
 * credited customer B's purchase to customer A. The server's linking module runs them
 * (apps/server/tests/link-reuse.test.ts); this package only holds the data.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface ReuseCustomer {
  id: string;
  code: string | null;
  role: "USER" | "HOUSE";
  status: "ACTIVE" | "MERGED";
}

export interface ReuseExistingRequest {
  requestId: string;
  customer: string;
  url: string;
  status: "QUEUED" | "ISSUED" | "DELIVERED" | "CONVERTED" | "FAILED";
  createdAt: string;
  affiliateUrl: string | null;
  shareCode: string | null;
}

export interface ReuseCase {
  name: string;
  story: string;
  existing: ReuseExistingRequest[];
  request: { customer: string; url: string };
  expected: { reused: boolean; customerId: string; requestId?: string; shareCode?: string };
}

export interface ReuseFixtureFile {
  rule: "reuse_link";
  source: string;
  now: string;
  directory: { customers: ReuseCustomer[]; aliases: Record<string, string> };
  cases: ReuseCase[];
}

export const LINK_REUSE_FIXTURE = fileURLToPath(new URL("../fixtures/linking/link-reuse.json", import.meta.url));

export function loadLinkReuseFixtures(path: string = LINK_REUSE_FIXTURE): ReuseFixtureFile {
  return JSON.parse(readFileSync(path, "utf8")) as ReuseFixtureFile;
}
