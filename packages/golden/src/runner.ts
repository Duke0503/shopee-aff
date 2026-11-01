/**
 * Golden fixtures: JSON examples computed independently (exact fractions) that
 * the money package must reproduce to the dong (NFR-1). Every money change adds
 * a case here.
 */
import { readFileSync } from "node:fs";

import { averageDong, classifyWithholding, clawbackAmount, combinedBalance, eventResult, operatorProfit, operatorShareOf, ratioBps, clawbackOpenAmount, fromNetworkUnits, nettingPlan, openClawbackTotal, partialClawbackAmount, payableBalance, shopeeCommission, shopeeEstimate, splitCommission, sumDong, type AffiliateNetwork } from "@cashback/money";

export interface GoldenCase {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

export interface GoldenFile {
  rule: "splitCommission" | "shopeeCommission" | "fromNetworkUnits" | "clawbackAmount" | "clawbackOpenAmount" | "payableBalance" | "nettingPlan" | "batchWithholding" | "operatorProfit" | "overviewRatio" | "eventResult" | "combinedBalance" | "shopeeEstimate";
  source?: string;
  cases: GoldenCase[];
}

type Input = Record<string, unknown>;

function num(input: Input, key: string): number {
  const value = input[key];
  if (typeof value !== "number") throw new Error(`golden input "${key}" must be a number`);
  return value;
}

function asNumbers(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "number")) throw new Error(`golden input ${what} must be an array of numbers`);
  return value;
}

const numbers = (input: Input, key: string): number[] => asNumbers(input[key], `"${key}"`);

function network(input: Input): AffiliateNetwork {
  const value = input["network"];
  if (value !== "shopee" && value !== "accesstrade") throw new Error(`unknown network ${String(value)}`);
  return value;
}

export function loadFixtureFile(path: string): GoldenFile {
  return JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
}

export function runCase(file: GoldenFile, testCase: GoldenCase): unknown {
  const input = testCase.input;
  switch (file.rule) {
    case "splitCommission":
      return splitCommission({
        approvedCommission: num(input, "approvedCommission"),
        network: network(input),
        withheld: input["withheld"] === true,
        guest: input["guest"] === true,
      });
    case "shopeeCommission":
      return shopeeCommission(num(input, "price"), num(input, "shopeeRateBps"), num(input, "xtraRateBps"));
    case "fromNetworkUnits": {
      const value = input["value"];
      if (typeof value !== "number" && typeof value !== "string") throw new Error("value must be a number or string");
      return fromNetworkUnits(value, num(input, "scale"));
    }
    case "clawbackAmount":
      return input["kind"] === "partial"
        ? partialClawbackAmount({ storedCashback: num(input, "storedCashback"), newCashback: num(input, "newCashback"), alreadyClawedBack: num(input, "alreadyClawedBack") })
        : clawbackAmount({ storedCashback: num(input, "storedCashback"), paidBonus: num(input, "paidBonus"), alreadyClawedBack: num(input, "alreadyClawedBack") });
    case "clawbackOpenAmount":
      return clawbackOpenAmount(numbers(input, "entries"));
    case "payableBalance": {
      const series = input["clawbackEntries"];
      if (!Array.isArray(series)) throw new Error("clawbackEntries must be an array of entry arrays");
      const gross = sumDong([...numbers(input, "cashback"), ...numbers(input, "bonuses")], "gross");
      const deductedNext = openClawbackTotal(series.map((entries, i) => clawbackOpenAmount(asNumbers(entries, `"clawbackEntries"[${i}]`))));
      return { gross, payable: payableBalance({ gross, openClawbacks: deductedNext }), deductedNext };
    }
    case "nettingPlan": {
      const gross = sumDong([...numbers(input, "cashback"), ...numbers(input, "bonuses")], "gross");
      const clawbacks = numbers(input, "openClawbacks").map((open, i) => ({ clawbackId: `C${i + 1}`, open }));
      const plan = nettingPlan(gross, clawbacks);
      return { gross, netting: plan.entries.map((e) => e.amount), carried: plan.entries.map((e) => e.carried), transfer: plan.transfer, carriedForward: plan.carriedForward };
    }
    case "batchWithholding":
      return classifyWithholding(network(input), num(input, "eligible"), num(input, "received"));
    case "operatorProfit": {
      const parts = { commission: num(input, "commission"), fee: num(input, "fee"), tax: num(input, "tax"), cashback: num(input, "cashback"), eventBonus: num(input, "eventBonus"), clawbackNetted: num(input, "clawbackNetted") };
      const profit = operatorProfit(parts);
      return { profit, marginBps: ratioBps(profit, parts.commission) };
    }
    case "overviewRatio":
      return input["kind"] === "average" ? averageDong(num(input, "numerator"), num(input, "denominator")) : ratioBps(num(input, "numerator"), num(input, "denominator"));
    case "eventResult": {
      const share = operatorShareOf({ commission: num(input, "commission"), fee: num(input, "fee"), tax: num(input, "tax"), cashback: num(input, "cashback") });
      return { operatorShare: share, result: eventResult(share, num(input, "bonus")) };
    }
    case "shopeeEstimate":
      return shopeeEstimate({ price: num(input, "price"), shopeeRateBps: num(input, "shopeeRateBps"), sellerRateBps: num(input, "sellerRateBps"), withheld: input["withheld"] === true });
    case "combinedBalance": {
      const parts = input["parts"];
      if (!Array.isArray(parts)) throw new Error("parts must be an array");
      return combinedBalance(parts.map((p: Input) => ({ gross: num(p, "gross"), deductedNext: num(p, "deductedNext"), waiting: num(p, "waiting"), paid: num(p, "paid") })));
    }
  }
}
