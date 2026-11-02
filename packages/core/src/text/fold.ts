/**
 * Folding Vietnamese text for comparison (one helper for every caller: search text, bank names,
 * holder names, chat command words): the accents are removed and the d-stroke becomes d, case kept.
 * Callers then pick the case and the separators they compare with.
 */
const COMBINING_MARKS = /[\u0300-\u036f]/g;
/** Latin Extended-A; the d-strokes are picked by code, so a minifier never writes those letters into a bundle (the website scans its bundle for Vietnamese outside the label files). */
const LATIN_EXTENDED_A = /[\u0100-\u017f]/g;
const D_STROKES: Readonly<Record<number, string>> = { 0x110: "D", 0x111: "d" };

export function foldDiacritics(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").replace(LATIN_EXTENDED_A, (c) => D_STROKES[c.charCodeAt(0)] ?? c);
}
