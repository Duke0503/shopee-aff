// @vitest-environment jsdom
/**
 * Story 5.3: the injected page scripts on a copy of the custom link form's structure (jsdom, no
 * network). Each looks once and returns; values go through the native setter and fire the events
 * a React form listens for.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { fillForm, pressSubmit, readPage, readResult, readResultBox, type FormSelectors } from "../src/page-scripts";
import { PAGE_ERROR, RESULT_FIELD, SOURCE_TEXTAREA, SUB_ID_FIELDS, SUBMIT_BUTTON_TEXT } from "../src/shopee-page";

const SELECTORS: FormSelectors = { textarea: SOURCE_TEXTAREA, subIdFields: SUB_ID_FIELDS, result: RESULT_FIELD, buttonLabel: SUBMIT_BUTTON_TEXT };

function customLinkForm(button = "Get Link"): void {
  document.body.innerHTML = `
    <div class="custom-textarea"><textarea></textarea></div>
    ${SUB_ID_FIELDS.map((s) => `<input id="${s.slice(1)}" />`).join("")}
    <button type="button">${button}</button>
    <textarea class="ant-input ant-input-disabled" disabled></textarea>`;
}

const field = (selector: string) => document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;

describe("Story 5.3: page scripts look once and return", () => {
  beforeEach(() => customLinkForm());

  it("sees whether the form is ready, in either language of the button, and a password box", () => {
    expect(readPage(SELECTORS)).toMatchObject({ ready: true, passwordBox: false });
    customLinkForm("L\u1ea5y link");
    expect(readPage(SELECTORS).ready).toBe(true);
    customLinkForm("Something else");
    expect(readPage(SELECTORS).ready).toBe(false);
    document.body.innerHTML = '<input type="password" />';
    expect(readPage(SELECTORS)).toMatchObject({ ready: false, passwordBox: true });
  });

  it("clears every field, then fills the source link and exactly the job's two sub_ids, firing input and change", () => {
    field(RESULT_FIELD).value = "https://s.shopee.vn/Old";
    field(SUB_ID_FIELDS[4] ?? "").value = "leftover";
    const events: string[] = [];
    document.body.addEventListener("input", () => events.push("input"));
    document.body.addEventListener("change", () => events.push("change"));
    expect(fillForm({ ...SELECTORS, url: "https://shopee.vn/x-i.1.2", subIds: ["DEV1000000000000000001", "DEV26110100001"] })).toEqual({ ok: true });
    expect(field(SOURCE_TEXTAREA).value).toBe("https://shopee.vn/x-i.1.2");
    expect(SUB_ID_FIELDS.map((s) => field(s).value)).toEqual(["DEV1000000000000000001", "DEV26110100001", "", "", ""]);
    expect(field(RESULT_FIELD).value).toBe("");
    expect(events.filter((e) => e === "input").length).toBeGreaterThanOrEqual(9);

    document.body.innerHTML = "";
    expect(fillForm({ ...SELECTORS, url: "https://shopee.vn/x", subIds: ["A", "B"] })).toEqual({ ok: false, why: "source box not found" });
  });

  it("presses the submit button once, and refuses a missing or disabled one", () => {
    let clicks = 0;
    document.querySelector("button")?.addEventListener("click", () => clicks++);
    expect(pressSubmit(SUBMIT_BUTTON_TEXT)).toEqual({ ok: true });
    expect(clicks).toBe(1);
    (document.querySelector("button") as HTMLButtonElement).disabled = true;
    expect(pressSubmit(SUBMIT_BUTTON_TEXT)).toEqual({ ok: false, why: "submit button is disabled" });
    document.body.innerHTML = "";
    expect(pressSubmit(SUBMIT_BUTTON_TEXT)).toEqual({ ok: false, why: "submit button not found" });
  });

  it("reads a new link, never the previous one, and a page error", () => {
    field(RESULT_FIELD).value = "https://s.shopee.vn/Previous";
    const previous = readResultBox(RESULT_FIELD);
    const look = () => readResult({ result: RESULT_FIELD, previous, errors: PAGE_ERROR });
    expect(look()).toEqual({ state: "waiting" });
    field(RESULT_FIELD).value = "https://s.shopee.vn/New1\n";
    expect(look()).toEqual({ state: "link", links: ["https://s.shopee.vn/New1"] });
    field(RESULT_FIELD).value = "";
    document.body.insertAdjacentHTML("beforeend", '<div class="ant-message-error">Product not supported</div>');
    expect(look()).toEqual({ state: "error", message: "Product not supported" });
  });
});
