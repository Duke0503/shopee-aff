/**
 * The text of a stored alert at send time (AD-27, D65): the row holds ids only, so the customer's
 * name and the product are read here, in the claim's transaction, and a retry reads them afresh.
 * An erased or unknown customer is named by the id alone, without the product.
 */
import type { LedgerDb } from "../../platform/db/ledger";
import { customerCardOf, ledgerOwnerOf } from "../identity/index";
import { linkRequestSubjectOf } from "../linking/index";
import { parseAlertDetail } from "./alert.command";
import type { AlertRow } from "./schema";
import { telegramText, type AlertRequestFacts } from "./telegram.adapter";

/** The most code points of product text shown, a name or a pasted link: a link can be far longer than one Telegram message holds. */
const PRODUCT_TEXT_MAX = 200;

function requestFactsOf(db: LedgerDb, requestId: string): AlertRequestFacts {
  const subject = linkRequestSubjectOf(db, requestId);
  if (subject === null) return { id: requestId, name: null, product: null };
  const owner = ledgerOwnerOf(db, subject.customerId);
  if (owner === null || owner.erasedAt !== null) return { id: owner?.customerId ?? subject.customerId, name: null, product: null };
  const name = customerCardOf(db, owner.customerId)?.displayName?.replace(/\s+/g, " ").trim() ?? "";
  return { id: owner.customerId, name: name === "" ? null : name, product: Array.from(subject.productName ?? subject.sourceUrl).slice(0, PRODUCT_TEXT_MAX).join("") };
}

/** Renders a stored alert; call inside `tx`, so it reads one state. */
export function renderStoredAlert(db: LedgerDb, alert: AlertRow): string {
  const detail = parseAlertDetail(alert.detail);
  return telegramText({ ...alert, detail }, detail?.requestId === undefined ? null : requestFactsOf(db, detail.requestId));
}
