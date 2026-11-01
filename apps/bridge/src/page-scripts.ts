/**
 * The scripts the bridge injects into the custom link page (main world, like the live CDP calls).
 * Each one looks once and returns at once: no timer, no promise that waits, no loop over time,
 * because Chrome throttles timers in a background tab to once a minute; every wait happens in the
 * service worker between two scripts, and every deadline comes from the server's job. Each
 * function is serialised on its own by `chrome.scripting`, so it may use only its argument and
 * the page's globals, never anything else from this file.
 *
 * Shopee's form is a React (antd) form: a value assigned directly never reaches React's state, so
 * values go through the native setter followed by the input and change events React listens for.
 */

export interface FormSelectors {
  readonly textarea: string;
  readonly subIdFields: readonly string[];
  readonly result: string;
  readonly buttonLabel: string;
}

export interface FillInput extends FormSelectors {
  readonly url: string;
  readonly subIds: readonly string[];
}

export type ScriptAnswer = { ok: true } | { ok: false; why: string };

/** Whether the link box and the submit button are both on the page, and what the tab shows. */
export function readPage(selectors: FormSelectors): { href: string; ready: boolean; passwordBox: boolean } {
  const wanted = new RegExp(selectors.buttonLabel, "i");
  const box = document.querySelector(selectors.textarea) !== null;
  const button = Array.from(document.querySelectorAll("button")).some((b) => wanted.test(b.textContent ?? ""));
  return { href: location.href, ready: box && button, passwordBox: document.querySelector("input[type=password]") !== null };
}

/** What the result box holds now: the previous submission's link, read before a new one. */
export function readResultBox(selector: string): string {
  const el = document.querySelector(selector);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value.trim() : "";
}

/** Clears every field, the result box included, then fills the one source link and its sub_ids. */
export function fillForm(input: FillInput): ScriptAnswer {
  const setValue = (el: Element | null, value: string): boolean => {
    if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  for (const selector of [input.textarea, input.result, ...input.subIdFields]) setValue(document.querySelector(selector), "");
  if (!setValue(document.querySelector(input.textarea), input.url)) return { ok: false, why: "source box not found" };
  for (const [i, value] of input.subIds.entries()) {
    const selector = input.subIdFields[i];
    if (selector === undefined || !setValue(document.querySelector(selector), value)) return { ok: false, why: `sub_id${i + 1} field not found` };
  }
  return { ok: true };
}

/** Presses the submit button, found by its label. */
export function pressSubmit(buttonLabel: string): ScriptAnswer {
  const wanted = new RegExp(buttonLabel, "i");
  const button = Array.from(document.querySelectorAll("button")).find((b) => wanted.test(b.textContent ?? ""));
  if (button === undefined) return { ok: false, why: "submit button not found" };
  if (button.disabled) return { ok: false, why: "submit button is disabled" };
  button.click();
  return { ok: true };
}

export type ResultLook = { state: "link"; links: string[] } | { state: "error"; message: string } | { state: "waiting" };

/**
 * One look at the result box. A link counts only when it differs from what the box held before
 * this submission: otherwise the previous customer's link would be read back as this one's.
 */
export function readResult(input: { result: string; previous: string; errors: string }): ResultLook {
  const el = document.querySelector(input.result);
  const text = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value.trim() : "";
  if (text !== "" && /shopee/i.test(text) && text !== input.previous) {
    return { state: "link", links: text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== "") };
  }
  const error = document.querySelector(input.errors);
  const message = (error?.textContent ?? "").trim();
  return message === "" ? { state: "waiting" } : { state: "error", message: message.slice(0, 120) };
}

export interface StorefrontSelectors {
  readonly name: readonly string[];
  readonly image: string;
  readonly price: readonly string[];
}

export interface StorefrontLook {
  readonly href: string;
  readonly passwordBox: boolean;
  readonly name: string | null;
  readonly image: string | null;
  readonly priceText: string | null;
}



/**
 * One look at the storefront product page: its name (without the site suffix), picture and the
 * whole text of the price element as shown. Nothing is extracted from the price: a range or a
 * "from" price is sent as it is, and the server refuses it.
 */
export function readStorefront(selectors: StorefrontSelectors): StorefrontLook {
  const valueOf = (selector: string): string => {
    const el = document.querySelector(selector);
    if (el === null) return "";
    return (el instanceof HTMLMetaElement ? el.content : (el.textContent ?? "")).replace(/\s+/g, " ").trim();
  };
  const first = (list: readonly string[]): string | null => list.map(valueOf).find((v) => v !== "") ?? null;
  const name = first(selectors.name)?.replace(/\s*\|\s*shopee.*$/i, "") ?? null;
  const price = first(selectors.price);
  const image = valueOf(selectors.image);
  return {
    href: location.href,
    passwordBox: document.querySelector("input[type=password]") !== null,
    name: name === "" ? null : name,
    image: image.startsWith("https://") ? image : null,
    priceText: price !== null && price.length <= 120 ? price : null,
  };
}

export interface OfferLookInput {
  readonly itemId: string;
  readonly card: string;
  readonly empty: string;
  /** The label of the commission element, a regular expression source (case-insensitive). */
  readonly commissionLabel: string;
  /** The label of the XTRA element. */
  readonly xtraLabel: string;
}

export type OfferLook =
  | { readonly state: "found"; readonly commissionTexts: string[]; readonly xtraTexts: string[]; readonly priceText: string | null }
  | { readonly state: "absent" }
  | { readonly state: "waiting" };

/**
 * One look at page 1 of the offer search: the card that links to this item, with the whole texts
 * of its elements labelled as the commission and as XTRA (a label's own text when it holds the
 * percentage, else its parent's), and its price texts, all as shown; or "absent" once the cards or
 * the empty state are there without it. Nothing is picked out here: a discount badge carries no
 * commission label, and a text that holds two percentages is sent whole, so the server can refuse
 * anything ambiguous. A text too long to send goes as "unreadable".
 */
export function readOfferResults(input: OfferLookInput): OfferLook & { href: string; passwordBox: boolean } {
  const page = { href: location.href, passwordBox: document.querySelector("input[type=password]") !== null };
  const own = new RegExp(`(^|\\D)${input.itemId}(\\D|$)`);
  const link = Array.from(document.querySelectorAll("a[href]")).find((a) => own.test(a.getAttribute("href") ?? ""));
  if (link === undefined) {
    const loaded = document.querySelector(input.card) !== null || document.querySelector(input.empty) !== null;
    return { ...page, state: loaded ? "absent" : "waiting" };
  }
  const card = link.closest(input.card) ?? link;
  const textOf = (el: Element | null): string => (el?.textContent ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const leaves = Array.from(card.querySelectorAll("*")).filter((el) => el.children.length === 0 && textOf(el) !== "");
  const commission = new RegExp(input.commissionLabel, "i");
  const xtra = new RegExp(input.xtraLabel, "i");
  const labelled = (label: RegExp, not: RegExp | null): string[] => {
    const texts = leaves.filter((el) => label.test(textOf(el)) && (not === null || !not.test(textOf(el)))).map((el) => (/\d\s*%/.test(textOf(el)) ? textOf(el) : textOf(el.parentElement)));
    const distinct = Array.from(new Set(texts));
    return distinct.length > 10 || distinct.some((t) => t.length > 200) ? ["unreadable"] : distinct;
  };
  const prices = leaves.map(textOf).filter((t) => t.includes("\u20ab")).join(" ");
  return { ...page, state: "found", commissionTexts: labelled(commission, xtra), xtraTexts: labelled(xtra, null), priceText: prices !== "" && prices.length <= 120 ? prices : null };
}

export interface ReportTableInput {
  readonly row: string;
  readonly empty: string;
  readonly pager: string;
  readonly activePage: string;
  readonly loading: string;
  readonly maxRows: number;
}

export type ReportLook = { readonly href: string; readonly passwordBox: boolean; readonly shownPage: number | null; readonly total: number | null } & (
  | { readonly state: "rows"; readonly records: unknown[] }
  | { readonly state: "empty" | "waiting" | "unreadable" }
);

/**
 * One look at the conversion report table: the record each row was rendered from (found up the
 * row's React fiber, as the live payout reader does), the page the pager marks as shown, and the
 * total the pager was given. Nothing is read out of the records here; a row without a record, or
 * more rows than one page holds, is "unreadable", and the server decides on everything else.
 */
export function readReportTable(input: ReportTableInput): ReportLook {
  const propOf = (el: Element, key: string): unknown => {
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
    let node = fiberKey === undefined ? null : (el as unknown as Record<string, unknown>)[fiberKey];
    for (let depth = 0; node !== null && typeof node === "object" && depth < 40; depth++) {
      const props = (node as { memoizedProps?: unknown }).memoizedProps;
      if (props !== null && typeof props === "object" && key in props) return (props as Record<string, unknown>)[key];
      node = (node as { return?: unknown }).return ?? null;
    }
    return undefined;
  };
  const activeText = (document.querySelector(input.activePage)?.textContent ?? "").trim();
  const pager = document.querySelector(input.pager);
  const total = pager === null ? undefined : propOf(pager, "total");
  const base = {
    href: location.href,
    passwordBox: document.querySelector("input[type=password]") !== null,
    shownPage: /^\d{1,4}$/.test(activeText) ? Number(activeText) : null,
    total: typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : null,
  };
  if (document.querySelector(input.loading) !== null) return { ...base, state: "waiting" };
  const rows = Array.from(document.querySelectorAll(input.row));
  if (rows.length === 0) return { ...base, state: document.querySelector(input.empty) === null ? "waiting" : "empty" };
  const records = rows.map((r) => propOf(r, "record"));
  if (rows.length > input.maxRows || records.some((r) => r === null || typeof r !== "object" || Array.isArray(r))) return { ...base, state: "unreadable" };
  try {
    return { ...base, state: "rows", records: JSON.parse(JSON.stringify(records)) as unknown[] };
  } catch {
    return { ...base, state: "unreadable" };
  }
}
