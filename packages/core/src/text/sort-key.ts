/**
 * Stored Vietnamese sort key (AD-12). Names are ordered by the Vietnamese alphabet,
 * where a, a-breve, a-circumflex and d, d-stroke are different letters, and then by
 * tone. SQLite compares text by bytes, so the key is ASCII: one character per letter,
 * then one tone digit per letter, and `ORDER BY sort_key` gives the Vietnamese order.
 */

export type SortKey = string & { readonly __brand: "SortKey" };

/** Base letters in Vietnamese order; foreign letters f, j, w, z sit where Latin puts them. */
const ALPHABET = ["a", "a\u0306", "a\u0302", "b", "c", "d", "\u0111", "e", "e\u0302", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "o\u0302", "o\u031b", "p", "q", "r", "s", "t", "u", "u\u031b", "v", "w", "x", "y", "z"];
const FIRST_LETTER_CODE = 0x41;
const LETTER_CODE = new Map(ALPHABET.map((letter, i) => [letter, String.fromCharCode(FIRST_LETTER_CODE + i)]));

/** Marks that make a different letter (breve, circumflex, horn). */
const LETTER_MARKS = new Set(["\u0306", "\u0302", "\u031b"]);
/** Tones in dictionary order after the level tone: grave, hook, tilde, acute, dot below. */
const TONES = ["\u0300", "\u0309", "\u0303", "\u0301", "\u0323"];

/** Sorts below every letter and digit, and the separator sorts below a space. */
const SEPARATOR = "!";
const SPACE = '"';

interface Unit {
  primary: string;
  tone: number;
}

function units(name: string): Unit[] {
  const chars = [...name.toLowerCase().trim().replace(/\s+/g, " ").normalize("NFD")];
  const result: Unit[] = [];
  for (const char of chars) {
    const last = result.at(-1);
    if (LETTER_MARKS.has(char) && last) {
      last.primary = LETTER_CODE.get(baseOf(last.primary) + char) ?? last.primary;
    } else if (TONES.includes(char) && last) {
      last.tone = TONES.indexOf(char) + 1;
    } else if (char === " ") {
      result.push({ primary: SPACE, tone: 0 });
    } else if (/[0-9]/.test(char)) {
      result.push({ primary: char, tone: 0 });
    } else if (LETTER_CODE.has(char)) {
      result.push({ primary: LETTER_CODE.get(char) ?? "", tone: 0 });
    }
  }
  return result;
}

function baseOf(code: string): string {
  return ALPHABET[code.charCodeAt(0) - FIRST_LETTER_CODE] ?? "";
}

/** Builds the stored `sort_key` of a name. */
export function sortKey(name: string): SortKey {
  const parts = units(name);
  return (parts.map((u) => u.primary).join("") + SEPARATOR + parts.map((u) => String(u.tone)).join("")) as SortKey;
}
