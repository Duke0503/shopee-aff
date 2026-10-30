/**
 * Which VietQR bank a written bank name means (FR-10, M-7), ported from the live system's
 * `core/banks.py::find` by way of the earlier v2 attempt. A wrong guess is not cosmetic: the same
 * account number can exist at another bank, so a wrong BIN sends money to a stranger. A name that
 * matches no bank, or more than one, is null, and the operator transfers by hand.
 *
 * Words that say nothing about which bank ("ngan hang", "TMCP", "thuong mai", "Viet Nam", "bank")
 * are dropped as whole words before the letters are joined, never as letters inside a word, so
 * "Thinh Vuong" stays "thinhvuong" and "Ngoai thuong" stays "ngoaithuong".
 */
import CATALOGUE from "./vietqr-banks.json" with { type: "json" };

export interface VietQrBank {
  readonly code: string;
  /** The 6-digit NAPAS bank identification number a VietQR carries. */
  readonly bin: string;
  readonly shortName: string;
  readonly name: string;
}

export const VIETQR_BANKS: readonly VietQrBank[] = CATALOGUE.banks.filter((b): b is VietQrBank => typeof b.bin === "string" && typeof b.code === "string" && typeof b.shortName === "string" && typeof b.name === "string");

/** Whole words, after folding, that never tell banks apart. */
const BOILERPLATE = /(?:^| )(?:ngan hang|thuong mai|co phan|viet nam|vietnam|tmcp|nhtmcp|bank|jsc|limited|ltd|nh|vn)(?= |$)/g;
const COMBINING_MARKS = /[̀-ͯ]/g;
const D_STROKE = /đ/g;

/** Lower case, diacritics and the d-stroke folded, words separated by one space. */
function words(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().replace(D_STROKE, "d").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Letters and digits only, for comparing spellings. */
export function plainBankText(text: string): string {
  return words(text).replace(/ /g, "");
}

/** The words that name the bank, boilerplate removed, joined. */
export function distinctiveBankText(text: string): string {
  let rest = words(text);
  for (let previous = ""; previous !== rest; ) {
    previous = rest;
    rest = rest.replace(BOILERPLATE, " ").replace(/ +/g, " ").trim();
  }
  return rest.replace(/ /g, "");
}

function aliasesOf(bank: VietQrBank): Set<string> {
  const aliases = new Set([bank.code, bank.shortName, bank.bin].map(plainBankText).filter((a) => a !== ""));
  const distinctive = distinctiveBankText(bank.name);
  if (distinctive.length >= 4) aliases.add(distinctive);
  return aliases;
}

const ALIASES = new Map(VIETQR_BANKS.map((bank) => [bank, aliasesOf(bank)]));

const oneBank = (found: readonly VietQrBank[]): VietQrBank | null => (new Set(found.map((b) => b.bin)).size === 1 ? (found[0] ?? null) : null);

/** The one bank a written name means, or null when none or several match. */
export function findVietQrBank(written: string | null, catalogue: readonly VietQrBank[] = VIETQR_BANKS): VietQrBank | null {
  const plain = plainBankText(written ?? "");
  if (plain === "") return null;
  const aliases = (bank: VietQrBank): Set<string> => ALIASES.get(bank) ?? aliasesOf(bank);
  const needles = new Set([plain, distinctiveBankText(written ?? "")].filter((n) => n !== ""));
  const exact = catalogue.filter((bank) => [...needles].some((n) => aliases(bank).has(n)));
  if (exact.length > 0) return oneBank(exact);
  return oneBank(catalogue.filter((bank) => [...aliases(bank)].some((alias) => alias.length >= 4 && plain.includes(alias))));
}
