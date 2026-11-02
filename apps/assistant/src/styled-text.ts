/**
 * Text styles in a message label (owner requirement 2026-11-02: the messages look as the live bot's
 * did). The live assistant bolded parts of its replies through zca-js `styles` (`st: "b"`, the
 * only style it used); a label marks the same parts with `**...**`, so the style lives in
 * packages/labels and never in code. The markers are removed and each marked run becomes one
 * range. Offsets and lengths count UTF-16 code units, as zca-js reads them and as the live bot
 * computed them (`String.indexOf`, `.length`).
 *
 * The markup is read from the label before its placeholders are filled, so a value (a product
 * name, a person's name) can never open or close a style. A value may itself be styled text (a
 * line written from another label); its ranges move with it.
 */

/** zca-js `TextStyle` codes other than the indent: bold, italic, underline, strike, colours, sizes. */
export type TextStyleCode = "b" | "i" | "u" | "s" | "c_db342e" | "c_f27806" | "c_f7b503" | "c_15a85f" | "f_13" | "f_18";

export interface TextStyle {
  readonly start: number;
  readonly len: number;
  readonly st: TextStyleCode;
}

export interface StyledText {
  readonly text: string;
  readonly styles: readonly TextStyle[];
}

export type StyledValue = string | number | StyledText;

const BOLD_MARK = "**";
const PLACEHOLDER = /\{(\w+)\}/g;

export const plain = (text: string): StyledText => ({ text, styles: [] });

export const isStyled = (value: StyledValue): value is StyledText => typeof value === "object";

/** The ranges moved `by` code units, as when text is written in front of them. */
export function shiftStyles(styles: readonly TextStyle[], by: number): TextStyle[] {
  return styles.map((s) => ({ ...s, start: s.start + by }));
}

/** Pieces joined in order, each piece's ranges moved to where it lands. */
export function joinStyled(pieces: readonly StyledValue[], separator = ""): StyledText {
  let text = "";
  const styles: TextStyle[] = [];
  pieces.forEach((piece, i) => {
    if (i > 0) text += separator;
    const styled = isStyled(piece) ? piece : plain(String(piece));
    styles.push(...shiftStyles(styled.styles, text.length));
    text += styled.text;
  });
  return { text, styles };
}

/** True when every `**` in the template has its pair. */
export const balancedMarkup = (template: string): boolean => template.split(BOLD_MARK).length % 2 === 1;

/**
 * The template with its bold runs as ranges and its placeholders filled by `valueOf`; a run that
 * fills to nothing gets no range. `valueOf` answers undefined for a name it has no value for, and
 * the placeholder is then left as written (the caller decides whether that is an error).
 */
export function renderStyled(template: string, valueOf: (name: string) => StyledValue | undefined): StyledText {
  if (!balancedMarkup(template)) throw new Error("a bold marker (**) has no pair");
  const out: StyledValue[] = [];
  const styles: TextStyle[] = [];
  let length = 0;
  template.split(BOLD_MARK).forEach((run, index) => {
    const start = length;
    let last = 0;
    for (const match of run.matchAll(PLACEHOLDER)) {
      const value = valueOf(match[1] ?? "");
      const pieces: StyledValue[] = [run.slice(last, match.index), value ?? match[0]];
      for (const piece of pieces) {
        out.push(piece);
        length += isStyled(piece) ? piece.text.length : String(piece).length;
      }
      last = (match.index ?? 0) + match[0].length;
    }
    const tail = run.slice(last);
    out.push(tail);
    length += tail.length;
    if (index % 2 === 1 && length > start) styles.push({ start, len: length - start, st: "b" });
  });
  const joined = joinStyled(out);
  return { text: joined.text, styles: [...styles, ...joined.styles].sort((a, b) => a.start - b.start || b.len - a.len) };
}

/** The text with every `**` marker removed: the label as it reads. */
export const withoutMarkup = (template: string): string => template.split(BOLD_MARK).join("");
