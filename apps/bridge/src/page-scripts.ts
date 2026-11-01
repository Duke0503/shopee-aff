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
