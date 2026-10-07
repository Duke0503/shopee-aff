/**
 * Matching a written bank name to the NAPAS BIN a VietQR code needs.
 * Ports `core/banks.py::find`. Getting it wrong is not cosmetic: the same
 * account number can exist at another bank, so a wrong BIN sends money to a
 * stranger. Two candidates means ambiguous, and ambiguous means null — the
 * owner then transfers by hand.
 */
export interface BankInfo {
  code?: string | null;
  shortName?: string | null;
  bin?: string | null;
  name?: string | null;
}

/** Words that carry no information about WHICH bank. */
const BOILERPLATE = /(nganhang|tmcp|thuongmai|cophan|vietnam|bank|jsc|limited|ltd|nh|vn)/g;

/** Lowercase, strip diacritics and every non-alphanumeric character. */
export function plain(text: string): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "");
}

/** Every spelling of one bank that can be matched without ambiguity. */
export function bankAliases(bank: BankInfo): Set<string> {
  const raw = [bank.code, bank.shortName, bank.bin].filter((value): value is string =>
    Boolean(value),
  );
  const aliases = new Set(raw.map(plain).filter((value) => value !== ""));

  const distinctive = plain(bank.name ?? "").replace(BOILERPLATE, "");
  if (distinctive.length >= 4) aliases.add(distinctive);
  return aliases;
}

/** The bank a customer meant, or null when it is not certain. */
export function findBank(written: string, catalogue: BankInfo[]): BankInfo | null {
  if (catalogue.length === 0) return null;
  const needle = plain(written);
  if (!needle) return null;

  // 1. Exact match on any known spelling.
  for (const bank of catalogue) {
    if (bankAliases(bank).has(needle)) return bank;
  }

  // 2. Token / containment match that must land on exactly ONE bank.
  const tokens = needle.split(/[^a-z0-9]+/).filter((token) => token !== "");
  const candidates: BankInfo[] = [];
  const seenBins = new Set<string>();

  for (const bank of catalogue) {
    const aliases = [...bankAliases(bank)];
    const bin = String(bank.bin ?? "");
    const hit =
      aliases.some((alias) => tokens.some((token) => token.length >= 2 && token === alias)) ||
      aliases.some((alias) => alias.length >= 4 && needle.includes(alias));
    if (hit && !seenBins.has(bin)) {
      candidates.push(bank);
      seenBins.add(bin);
    }
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
