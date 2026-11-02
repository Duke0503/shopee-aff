/**
 * The missing-order report on the public listener (FR-14, AD-18, INV-5; Story 7.4, pen.dev Gc1Zb):
 *
 *   POST /api/me/missing-orders   the signed-in customer reports a purchase the list does not show
 *
 * The customer is the one the session cookie names; the request needs the website's own Origin.
 * Each field is checked here and a broken rule is said under its field: the order id in Shopee's
 * or TikTok Shop's form, the purchase day neither in the future nor more than
 * `MISSING_ORDER_MAX_DAYS` ago, the product link (optional) a web address. The orders module opens
 * the review case, at most one open per order id and a few per customer a day; nothing about money
 * or an order changes. The answer says only received, already reported by this customer, or
 * already recorded as theirs; the log carries the outcome and never what was typed.
 */
import { MISSING_ORDER_ID, MY_MISSING_ORDERS_PATH, missingOrderRequestSchema, missingOrderResponseSchema } from "@cashback/contracts";
import { addVnDays, parseVnDate, vnToday, type Clock } from "@cashback/core";

import { customerKeys, customerSessionOf } from "../modules/identity/index";
import { commandAudit } from "../modules/operations/index";
import { reportMissingOrder, type MissingOrderReport } from "../modules/orders/index";
import type { Ledger } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { requireOrigin } from "../platform/http/origin.guard";
import type { PublicRoutes } from "../platform/http/servers";
import { CUSTOMER_SESSION_COOKIE, readCookie } from "../platform/http/session-cookie";

/** How far back a purchase may be reported; older ones go through Zalo. */
export const MISSING_ORDER_MAX_DAYS = 120;

export interface MissingOrderRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly origins: readonly string[];
}

type Form = Omit<MissingOrderReport, "customerId" | "customerIds">;

function dayRule(text: string, clock: Clock): boolean {
  try {
    const day = parseVnDate(text);
    const today = vnToday(clock);
    return day <= today && day >= addVnDays(today, -MISSING_ORDER_MAX_DAYS);
  } catch {
    return false;
  }
}

function linkRule(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The report the form describes, or every broken rule by field. */
function readForm(body: unknown, clock: Clock): Form {
  const parsed = missingOrderRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError("invalid_request", "error.invalid_request");
  const orderId = parsed.data.orderId.replace(/[\s-]+/g, "").toUpperCase();
  const productUrl = parsed.data.productUrl.trim();
  const note = parsed.data.note.trim();
  const fields: Record<string, string> = {};
  if (!MISSING_ORDER_ID.test(orderId)) fields["orderId"] = "error.missing_order.order_id_rule";
  if (!dayRule(parsed.data.purchasedOn, clock)) fields["purchasedOn"] = "error.missing_order.date_rule";
  if (productUrl !== "" && !linkRule(productUrl)) fields["productUrl"] = "error.missing_order.link_rule";
  const first = Object.values(fields)[0];
  if (first !== undefined) throw new HttpError("invalid_request", first, fields);
  return { orderId, purchasedOn: parsed.data.purchasedOn, productUrl: productUrl === "" ? null : productUrl, note: note === "" ? null : note, checks: parsed.data.checks };
}

export function missingOrderRoutes(deps: MissingOrderRouteDeps): PublicRoutes {
  return (app) => {
    app.post(MY_MISSING_ORDERS_PATH, async (request, reply) => {
      requireOrigin(request, deps.origins);
      void reply.header("cache-control", "no-store");
      const customerId = customerSessionOf(deps.ledger.db, readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE), deps.clock);
      if (customerId === null) throw new HttpError("unauthorized", "error.unauthorized");
      const form = readForm(request.body, deps.clock);
      const outcome = deps.ledger.tx((db) => {
        const customerIds = customerKeys(db, customerId)?.keys ?? [customerId];
        const by = commandAudit(db, deps.clock, { kind: "customer", id: customerId });
        return reportMissingOrder(db, { customerId, customerIds, ...form }, { by, at: deps.clock.now() });
      });
      request.log.info({ result: outcome.result }, "orders.missing_order.answered");
      if (outcome.result === "rate_limited") throw new HttpError("rate_limited", "error.missing_order.too_many");
      return missingOrderResponseSchema.parse({ result: outcome.result, orderId: form.orderId });
    });
  };
}
