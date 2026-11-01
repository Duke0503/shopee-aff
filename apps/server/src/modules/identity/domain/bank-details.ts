/**
 * Reading the bank details a customer writes in the Zalo chat (FR-10, M-7, Story 6.9):
 * "<bank> <number> <holder>", as the messages ask, or "<number> <bank> <holder>", as customers of
 * the live assistant wrote it. The number is the one run of words that carry a digit; spaces and
 * dashes inside it are removed and it must then be 4 to 30 letters and digits. The holder is
 * stored in upper case without diacritics, as banks print it. The bank must be exactly one VietQR
 * bank: a name that matches several is a choice for the customer, never a guess, because the same
 * number can exist at another bank and a wrong BIN pays a stranger.
 */
import { normaliseAccountNumber } from "./account-number";
import { vietQrBankMatches, type VietQrBank } from "./bank-match";

export const ACCOUNT_NUMBER_RULE = /^[A-Z0-9]{4,30}$/;
const HOLDER_RULE = /^[A-Z]+(?: [A-Z]+)*$/;
const HOLDER_MAX = 70;
/** Words a bank name may take when the number comes first. */
const BANK_WORDS_MAX = 4;

export type BankDetails =
  | { readonly kind: "ok"; readonly bank: VietQrBank; readonly accountNumber: string; readonly holderName: string }
  | { readonly kind: "choose_bank"; readonly banks: readonly VietQrBank[] }
  | { readonly kind: "invalid"; readonly rule: "format" | "number" | "holder" | "bank" };

const hasDigit = (word: string): boolean => /\d/.test(word);

/** Upper case, diacritics and the d-stroke folded, one space between words: how two spellings of a holder compare. */
export function foldHolderName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0111\u0110]/g, "D")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The holder as stored, or null when it is not a name in letters. */
export function holderNameOf(words: readonly string[]): string | null {
  const folded = foldHolderName(words.join(" "));
  return folded.length >= 2 && folded.length <= HOLDER_MAX && HOLDER_RULE.test(folded) ? folded : null;
}

/** The words before and after the one run of words with a digit, or null when there is not exactly one run. */
function split(words: readonly string[]): { before: string[]; number: string[]; after: string[] } | null {
  const first = words.findIndex(hasDigit);
  if (first < 0) return null;
  let end = first;
  while (end < words.length && hasDigit(words[end] ?? "")) end++;
  if (words.slice(end).some(hasDigit)) return null;
  return { before: words.slice(0, first), number: words.slice(first, end), after: words.slice(end) };
}

/** Words that only say "bank" ("Bank", "NH", "TMCP", "Ngan hang"), never part of a holder's name. */
const FILLER = new Set(["BANK", "NH", "TMCP"]);

/** How many of the leading words are bank filler; "Ngan hang" counts only as a pair, since Hang is a name. */
function leadingFiller(words: readonly string[]): number {
  let n = 0;
  for (;;) {
    const word = foldHolderName(words[n] ?? "");
    if (FILLER.has(word)) n++;
    else if (word === "NGAN" && foldHolderName(words[n + 1] ?? "") === "HANG") n += 2;
    else return n;
  }
}

/** Bank words, and the holder without the bank filler written after the bank ("MB Bank NGUYEN VAN A"). */
function withFiller(bank: readonly string[], rest: readonly string[]): { bank: string[]; holder: string[] } {
  const filler = leadingFiller(rest);
  return { bank: [...bank, ...rest.slice(0, filler)], holder: rest.slice(filler) };
}

/**
 * With the number first: the fewest leading words that name a bank (a longer run would swallow
 * the holder, since a name is matched by containment too), then the filler after it; the rest is
 * the holder.
 */
function bankFirstOf(words: readonly string[]): { bank: string[]; holder: string[] } | null {
  const start = leadingFiller(words);
  for (let n = start + 1; n <= Math.min(start + BANK_WORDS_MAX, words.length - 1); n++) {
    if (vietQrBankMatches(words.slice(0, n).join(" ")).length > 0) return withFiller(words.slice(0, n), words.slice(n));
  }
  return null;
}

export function readBankDetails(text: string): BankDetails {
  const words = text.trim().split(/\s+/).filter((w) => w !== "");
  const parts = split(words);
  if (parts === null) return { kind: "invalid", rule: "format" };
  const accountNumber = normaliseAccountNumber(parts.number.join(" "));
  if (!ACCOUNT_NUMBER_RULE.test(accountNumber)) return { kind: "invalid", rule: "number" };
  const named = parts.before.length > 0 ? withFiller(parts.before, parts.after) : bankFirstOf(parts.after);
  if (named === null) return { kind: "invalid", rule: parts.after.length === 0 ? "format" : "bank" };
  if (named.bank.length === 0 || named.holder.length === 0) return { kind: "invalid", rule: "format" };
  const holderName = holderNameOf(named.holder);
  if (holderName === null) return { kind: "invalid", rule: "holder" };
  const banks = vietQrBankMatches(named.bank.join(" "));
  if (banks.length === 0) return { kind: "invalid", rule: "bank" };
  if (banks.length > 1) return { kind: "choose_bank", banks };
  return { kind: "ok", bank: banks[0] as VietQrBank, accountNumber, holderName };
}
