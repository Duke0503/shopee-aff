/**
 * One link job on the custom link page (Story 5.3; the live `link_generator.py` read as
 * reference): one source link with this request's sub_id1 and sub_id2, one link back. Steps: the
 * page is open and not blocked by a verification or login page, the form is there (one reload if
 * it never appears), the result box's old value is read, the form is filled and submitted, and the
 * result box is read until a new link or a Shopee error shows, within the job's own timeout.
 *
 * The answer is a link or a reason; the server checks the link (host and sub_ids) before it is
 * attached, so nothing here is trusted beyond "it is an https Shopee link". Every pause is in the
 * service worker; the page scripts look once and return.
 */
import type { BridgeFailure, BridgeLinkJob } from "@cashback/contracts";

import type { PageDriver, Wait } from "./bridge-tab";
import { fillForm, pressSubmit, readPage, readResult, readResultBox, type FormSelectors } from "./page-scripts";
import { CUSTOM_LINK_URL, isShopeeLink, PAGE_ERROR, pageBlock, RESULT_FIELD, SOURCE_TEXTAREA, SUB_ID_FIELDS, SUBMIT_BUTTON_TEXT } from "./shopee-page";

export type LinkAnswer = { outcome: "link"; url: string } | { outcome: "failed"; reason: BridgeFailure };

/** How long to wait for the form: first as the page stands, then after one reload (as live). */
export const FORM_WAITS_MS = [12_000, 20_000] as const;
export const FORM_POLL_MS = 500;
export const RESULT_POLL_MS = 300;
/** A pause before pressing submit, at a person's pace. */
export const BEFORE_SUBMIT_MS = 500;
/** An error line can linger from the previous submission for a moment. */
const ERROR_GRACE_MS = 2_000;
/** Kept back from the job's timeout for the answer to reach the server in time. */
const ANSWER_MARGIN_MS = 5_000;

const SELECTORS: FormSelectors = { textarea: SOURCE_TEXTAREA, subIdFields: SUB_ID_FIELDS, result: RESULT_FIELD, buttonLabel: SUBMIT_BUTTON_TEXT };

class StepFailure extends Error {
  constructor(readonly reason: BridgeFailure) {
    super(reason);
  }
}

const fail = (reason: BridgeFailure): never => {
  throw new StepFailure(reason);
};

async function blocked(page: PageDriver): Promise<void> {
  const look = await page.run(readPage, SELECTORS);
  const block = pageBlock(look.href, look.passwordBox);
  if (block !== null) fail(block);
}

/** Waits for the form within `limitMs`; true once both the link box and the button are there. */
async function formAppears(page: PageDriver, wait: Wait, limitMs: number): Promise<boolean> {
  for (let waited = 0; ; waited += FORM_POLL_MS) {
    const look = await page.run(readPage, SELECTORS);
    const block = pageBlock(look.href, look.passwordBox);
    if (block !== null) fail(block);
    if (look.ready) return true;
    if (waited >= limitMs) return false;
    await wait(FORM_POLL_MS);
  }
}

async function openForm(page: PageDriver, wait: Wait): Promise<void> {
  await page.prepare();
  if (!(await page.href()).startsWith(CUSTOM_LINK_URL)) await page.open(CUSTOM_LINK_URL);
  for (const [attempt, limit] of FORM_WAITS_MS.entries()) {
    if (await formAppears(page, wait, limit)) return;
    if (attempt === 0) await page.open(CUSTOM_LINK_URL);
  }
  await blocked(page);
  fail("page_not_ready");
}

async function awaitResult(page: PageDriver, wait: Wait, previous: string, limitMs: number): Promise<LinkAnswer> {
  for (let waited = 0; waited <= limitMs; waited += RESULT_POLL_MS) {
    const look = await page.run(readResult, { result: RESULT_FIELD, previous, errors: PAGE_ERROR });
    if (look.state === "link") {
      const [link, ...more] = look.links;
      // One source link in, exactly one https Shopee link out; anything else is never guessed at.
      return link !== undefined && more.length === 0 && isShopeeLink(link, true) ? { outcome: "link", url: link } : { outcome: "failed", reason: "no_link" };
    }
    if (look.state === "error" && waited >= ERROR_GRACE_MS) return { outcome: "failed", reason: "shopee_refused" };
    await wait(RESULT_POLL_MS);
  }
  await blocked(page);
  return { outcome: "failed", reason: "no_link" };
}

export async function runLinkJob(job: BridgeLinkJob, page: PageDriver, wait: Wait): Promise<LinkAnswer> {
  if (!isShopeeLink(job.sourceUrl)) return { outcome: "failed", reason: "bad_job" };
  try {
    await openForm(page, wait);
    const previous = await page.run(readResultBox, RESULT_FIELD);
    const filled = await page.run(fillForm, { ...SELECTORS, url: job.sourceUrl, subIds: [job.subId1, job.subId2] });
    if (!filled.ok) return { outcome: "failed", reason: "form_missing" };
    await wait(BEFORE_SUBMIT_MS);
    const pressed = await page.run(pressSubmit, SUBMIT_BUTTON_TEXT);
    if (!pressed.ok) return { outcome: "failed", reason: "submit_failed" };
    // The form waits may already have used their share of the server's timeout.
    const left = job.timeoutMs - FORM_WAITS_MS[0] - FORM_WAITS_MS[1] - BEFORE_SUBMIT_MS - ANSWER_MARGIN_MS;
    return await awaitResult(page, wait, previous, Math.max(RESULT_POLL_MS * 10, left));
  } catch (error) {
    if (error instanceof StepFailure) return { outcome: "failed", reason: error.reason };
    return { outcome: "failed", reason: "script_error" };
  }
}
