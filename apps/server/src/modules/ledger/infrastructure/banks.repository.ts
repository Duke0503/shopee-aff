import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { BankInfo } from "../domain/bank-match";

/**
 * The NAPAS bank catalogue, read from `resources/banks.json` — the same file
 * the Python backend matches against, so a customer's bank name resolves to the
 * same BIN whichever server answers.
 *
 * A missing or unreadable catalogue is NOT an error the owner must fix before
 * paying: it only means no QR is offered and the transfer is typed by hand.
 */
export const DEFAULT_BANKS_PATH = fileURLToPath(
  new URL("../../../../../../resources/banks.json", import.meta.url),
);

export function banksPath(): string {
  return process.env.BANKS_PATH ?? DEFAULT_BANKS_PATH;
}

export function loadBankCatalogue(path: string = banksPath()): BankInfo[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as BankInfo[]) : [];
  } catch {
    return [];
  }
}
