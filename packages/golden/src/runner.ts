import { readFileSync } from "node:fs";

import {
  buildEstimate,
  estimateCashback,
  legacyRoundHalfEven,
  policyWarnings,
  roundDong,
  splitCommission,
  type TaxPolicy,
} from "@mmo/money";

export interface GoldenCase {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

export interface GoldenFile {
  rule: string;
  source?: string;
  cases: GoldenCase[];
}

type Input = Record<string, unknown>;

function num(input: Input, key: string): number {
  const value = input[key];
  if (typeof value !== "number") throw new Error(`golden input "${key}" must be a number`);
  return value;
}

function bool(input: Input, key: string): boolean {
  const value = input[key];
  if (typeof value !== "boolean") throw new Error(`golden input "${key}" must be a boolean`);
  return value;
}

function taxPolicy(input: Input, key: string): TaxPolicy {
  const value = input[key];
  if (value !== "owner_absorbs" && value !== "user_absorbs") {
    throw new Error(`golden input "${key}" must be a tax policy`);
  }
  return value;
}

export function loadFixtureFile(path: string): GoldenFile {
  return JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
}

/** Dispatch one case to the function named by rule, returning a JSON-comparable value. */
export function runCase(file: GoldenFile, testCase: GoldenCase): unknown {
  const input = testCase.input;

  switch (file.rule) {
    case "round_dong":
      return roundDong(num(input, "value"));
    case "legacy_round_half_even":
      return legacyRoundHalfEven(num(input, "value"));
    case "split_commission": {
      const split = splitCommission(
        num(input, "approved_commission"),
        num(input, "cashback_rate"),
        bool(input, "period_is_withheld"),
        taxPolicy(input, "tax_policy"),
      );
      return {
        service_fee: split.serviceFee,
        withheld_tax: split.withheldTax,
        customer_receives: split.customerReceives,
        operator_keeps: split.operatorKeeps,
      };
    }
    case "commission_estimate": {
      const estimate = buildEstimate(
        num(input, "price"),
        num(input, "shopee_rate"),
        num(input, "seller_rate"),
      );
      return {
        commission: estimate.commission,
        shopee_part: estimate.shopeePart,
        seller_part: estimate.sellerPart,
        is_capped: estimate.isCapped,
      };
    }
    case "estimate_cashback":
      return estimateCashback(num(input, "commission"), num(input, "cashback_rate"));
    case "policy_warnings":
      return {
        count: policyWarnings(
          taxPolicy(input, "tax_policy"),
          num(input, "cashback_rate"),
          num(input, "expected_monthly_commission"),
        ).length,
      };
    default:
      throw new Error(`no golden handler for rule "${file.rule}"`);
  }
}
