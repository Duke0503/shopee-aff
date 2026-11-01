/**
 * Product lookups (AD-14, D8, D56; Story 5.6): the product facts of a Shopee link request (name,
 * image, price and rates) read through the affiliate browser after its link is made. Like a link
 * submission it is a claim transaction, the bridge call with no transaction open, and a result
 * transaction. The facts become the request's product snapshot (D56) and the shared
 * `product_offers` row of the item: product facts may be shared across customers, links never are
 * (FR-5).
 *
 * A request without an estimate (no rate yet) gets at most `LOOKUPS_PER_REQUEST` lookups: the
 * second one no sooner than `LOOKUP_RETRY_MS` after the first ended, whatever it answered; after
 * that its reply keeps the dash. A later lookup never erases what an earlier one read: a field it
 * could not read keeps its known value, in the snapshot and in the shared facts alike, and the
 * shared facts count as refreshed only when a lookup read both the price and the rates. A product
 * whose complete shared facts were refreshed within `PRODUCT_FACTS_FRESH_MS` takes them without a
 * bridge job. Only requests made within `LOOKUP_WINDOW_MS` are looked up: an older reply has gone
 * out already. While the Shopee queue is held or paused no lookup is handed out, and a lookup that
 * meets a captcha or the login page holds or pauses the queue exactly as a link submission does
 * (Story 5.5), since it is the same session.
 */
import { bridgeLookupValueSchema } from "@cashback/contracts";
import { instantFromMs, searchText, toMs, type Clock, type Instant } from "@cashback/core";
import { shopeeCommission } from "@cashback/money";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { BridgeLookupResult, LookupBridgeJob } from "../../platform/ports/bridge.port";
import { CAPTCHA_HOLD_MS, LINK_QUEUE_ALERTS } from "./domain/link-failure";
import { readLookupFacts, type ProductFacts } from "./domain/product-lookup";
import { closeJob } from "./link-issue.command";
import { holdShopeeQueue, pauseShopeeQueue, shopeeQueueGate } from "./link-queue.command";
import type { LinkEffects } from "./link-result.command";
import { bridgeJobs, linkRequests, productOffers } from "./schema";

/** A request older than this gets no lookup: its reply went out without one. */
export const LOOKUP_WINDOW_MS = 2 * 60 * 60_000;
/** Complete shared product facts younger than this are taken as they are (the live hot-refresh policy). */
export const PRODUCT_FACTS_FRESH_MS = 6 * 60 * 60_000;
/** Times in a row the browser may take a lookup and go silent before it is given up. */
export const SILENT_LOOKUPS_BEFORE_FAILURE = 2;
/** A request without an estimate is looked up at most this many times. */
export const LOOKUPS_PER_REQUEST = 2;
/** The least time between the end of a request's first lookup and its second. */
export const LOOKUP_RETRY_MS = 10 * 60_000;

const minus = (at: Instant, ms: number): Instant => instantFromMs(toMs(at) - ms);

/** The item id in a `shopee:<shop>.<item>` product key. */
const itemIdOf = (productKey: string | null): string | null => /^shopee:\d+\.(\d+)$/.exec(productKey ?? "")?.[1] ?? null;

interface KnownRates {
  readonly shopeeRateBps: number | null;
  readonly sellerRateBps: number | null;
}

/** Rates count only as a pair: the new pair when this lookup read one, else the known one. */
const ratesOf = (fresh: ProductFacts, known: KnownRates): KnownRates => (fresh.shopeeRateBps !== null ? { shopeeRateBps: fresh.shopeeRateBps, sellerRateBps: fresh.sellerRateBps } : known);

/** Writes the facts onto the request as its snapshot (D56), keeping what an earlier lookup read and this one could not. */
function writeSnapshot(db: LedgerDb, requestId: string, facts: ProductFacts): void {
  const known = db
    .select({ name: linkRequests.productName, imageUrl: linkRequests.productImageUrl, price: linkRequests.productPrice, shopeeRateBps: linkRequests.shopeeRateBps, sellerRateBps: linkRequests.sellerRateBps })
    .from(linkRequests)
    .where(eq(linkRequests.requestId, requestId))
    .get();
  const name = facts.name ?? known?.name ?? null;
  const price = facts.price ?? known?.price ?? null;
  const rates = ratesOf(facts, known ?? { shopeeRateBps: null, sellerRateBps: null });
  const commission = price !== null && rates.shopeeRateBps !== null ? shopeeCommission(price, rates.shopeeRateBps, rates.sellerRateBps ?? 0).commission : null;
  db.update(linkRequests)
    .set({ productOfferId: facts.productOfferId, productName: name, productImageUrl: facts.imageUrl ?? known?.imageUrl ?? null, productPrice: price, ...rates, estimatedCommission: commission, searchText: searchText(name) })
    .where(eq(linkRequests.requestId, requestId))
    .run();
}

/**
 * The item's shared facts, inserted or merged: a field this lookup could not read keeps its known
 * value, and the facts count as refreshed (`updated_at`) only when it read both the price and the rates.
 */
function saveOffer(db: LedgerDb, facts: ProductFacts, at: Instant, canonicalUrl: string): void {
  const complete = facts.price !== null && facts.shopeeRateBps !== null;
  const rates = facts.shopeeRateBps !== null;
  db.insert(productOffers)
    .values({ productOfferId: facts.productOfferId, shopId: facts.shopId, name: facts.name, imageUrl: facts.imageUrl, price: facts.price, shopeeRateBps: facts.shopeeRateBps, sellerRateBps: facts.sellerRateBps, canonicalUrl, firstSeenAt: at, updatedAt: complete ? at : null, origin: "LOOKUP" })
    .onConflictDoUpdate({
      target: productOffers.productOfferId,
      set: {
        shopId: facts.shopId,
        canonicalUrl,
        name: facts.name ?? sql`${productOffers.name}`,
        imageUrl: facts.imageUrl ?? sql`${productOffers.imageUrl}`,
        price: facts.price ?? sql`${productOffers.price}`,
        shopeeRateBps: rates ? facts.shopeeRateBps : sql`${productOffers.shopeeRateBps}`,
        sellerRateBps: rates ? facts.sellerRateBps : sql`${productOffers.sellerRateBps}`,
        updatedAt: complete ? at : sql`${productOffers.updatedAt}`,
      },
    })
    .run();
}

/** The item's shared facts when they are fresh and complete (price and rates: an estimate can be made), else null. */
function freshOffer(db: LedgerDb, itemId: string, now: Instant): ProductFacts | null {
  const row = db.select().from(productOffers).where(and(eq(productOffers.productOfferId, itemId), gte(productOffers.updatedAt, minus(now, PRODUCT_FACTS_FRESH_MS)))).get();
  if (row === undefined || row.price === null || row.shopId === null || row.shopeeRateBps === null || row.sellerRateBps === null) return null;
  return { productOfferId: row.productOfferId, shopId: row.shopId, name: row.name, imageUrl: row.imageUrl, price: row.price, shopeeRateBps: row.shopeeRateBps, sellerRateBps: row.sellerRateBps };
}

/** The oldest request with a link and no estimate yet whose next lookup is due, Zalo first. */
function nextUnlooked(db: LedgerDb, now: Instant) {
  const mine = sql`j.kind = 'LOOKUP' AND j.request_id = ${linkRequests.requestId}`;
  const lookups = sql`(SELECT count(*) FROM bridge_jobs j WHERE ${mine})`;
  const open = sql`(SELECT count(*) FROM bridge_jobs j WHERE ${mine} AND j.status = 'PENDING')`;
  const lastEnded = sql`(SELECT coalesce(max(j.finished_at), '') FROM bridge_jobs j WHERE ${mine})`;
  return db
    .select({ requestId: linkRequests.requestId, sourceUrl: linkRequests.sourceUrl, productKey: linkRequests.productKey })
    .from(linkRequests)
    .where(
      and(
        inArray(linkRequests.status, ["ISSUED", "DELIVERED"]),
        eq(linkRequests.origin, "REQUEST"),
        sql`coalesce(${linkRequests.network}, 'shopee') = 'shopee'`,
        // A ShopeeFood request names a shop, not a product: there is nothing to look up (D60).
        sql`${linkRequests.platform} <> 'shopeefood'`,
        isNull(linkRequests.shopeeRateBps),
        gte(linkRequests.createdAt, minus(now, LOOKUP_WINDOW_MS)),
        sql`${lookups} < ${LOOKUPS_PER_REQUEST}`,
        sql`${open} = 0`,
        or(sql`${lookups} = 0`, sql`${lastEnded} <= ${minus(now, LOOKUP_RETRY_MS)}`),
      ),
    )
    .orderBy(sql`CASE WHEN ${linkRequests.channel} = 'web' THEN 1 ELSE 0 END`, asc(linkRequests.createdAt), asc(linkRequests.requestId))
    .get();
}

/** Claims the next lookup; call inside `tx`. Null when nothing is due or the Shopee queue is held or paused. */
export function claimLookupJob(db: LedgerDb, clock: Clock): LookupBridgeJob | null {
  const now = clock.now();
  if (shopeeQueueGate(db, now) !== "open") return null;
  const open = db.select({ jobId: bridgeJobs.jobId, requestId: bridgeJobs.requestId, url: bridgeJobs.sourceUrl }).from(bridgeJobs).where(and(eq(bridgeJobs.kind, "LOOKUP"), eq(bridgeJobs.status, "PENDING"))).orderBy(asc(bridgeJobs.jobId)).get();
  if (open !== undefined && open.requestId !== null && open.url !== null) return { jobId: open.jobId, requestId: open.requestId, url: open.url };
  for (let request = nextUnlooked(db, now); request !== undefined; request = nextUnlooked(db, now)) {
    const inserted = db.insert(bridgeJobs).values({ kind: "LOOKUP", status: "PENDING", requestId: request.requestId, sourceUrl: request.sourceUrl, createdAt: now }).returning({ jobId: bridgeJobs.jobId }).get();
    const itemId = itemIdOf(request.productKey);
    const shared = itemId === null ? null : freshOffer(db, itemId, now);
    if (shared === null) return { jobId: inserted.jobId, requestId: request.requestId, url: request.sourceUrl };
    // Fresh shared facts: the snapshot is taken from them and the job is done without the browser.
    writeSnapshot(db, request.requestId, shared);
    db.update(bridgeJobs).set({ status: "DONE", finishedAt: now }).where(eq(bridgeJobs.jobId, inserted.jobId)).run();
  }
  return null;
}

export interface LookupRecorded {
  readonly requestId: string;
  readonly outcome: "found" | "not_found" | "failed" | "held" | "paused" | "stale";
  readonly reason: string | null;
}

export type RecordedLookupAnswer = Exclude<BridgeLookupResult, { outcome: "unavailable" }>;

/** Records a lookup's answer; call inside `tx`. */
export function recordLookupResult(db: LedgerDb, job: LookupBridgeJob, answer: RecordedLookupAnswer, clock: Clock, effects: (db: LedgerDb) => LinkEffects): LookupRecorded {
  const at = clock.now();
  const done = (outcome: LookupRecorded["outcome"], reason: string | null = null): LookupRecorded => ({ requestId: job.requestId, outcome, reason });
  if (db.select({ status: bridgeJobs.status }).from(bridgeJobs).where(eq(bridgeJobs.jobId, job.jobId)).get()?.status !== "PENDING") return done("stale");
  if (answer.outcome === "failed") {
    closeJob(db, job.jobId, answer.reason, at);
    if (answer.reason === "captcha") {
      holdShopeeQueue(db, "captcha", instantFromMs(toMs(at) + CAPTCHA_HOLD_MS));
      effects(db).alerts.alert(LINK_QUEUE_ALERTS.captcha.kind, LINK_QUEUE_ALERTS.captcha.severity);
      return done("held", answer.reason);
    }
    if (answer.reason === "login_redirect") {
      if (pauseShopeeQueue(db, "login_redirect", at)) effects(db).alerts.alert(LINK_QUEUE_ALERTS.login_redirect.kind, LINK_QUEUE_ALERTS.login_redirect.severity);
      return done("paused", answer.reason);
    }
    return done("failed", answer.reason);
  }
  const value = bridgeLookupValueSchema.safeParse(answer.value);
  if (!value.success) {
    closeJob(db, job.jobId, "bad_answer", at);
    return done("failed", "bad_answer");
  }
  const facts = readLookupFacts(value.data);
  db.update(bridgeJobs).set({ status: "DONE", failure: facts === null ? "not_found" : null, finishedAt: at }).where(eq(bridgeJobs.jobId, job.jobId)).run();
  if (facts === null) return done("not_found");
  saveOffer(db, facts, at, `https://shopee.vn/product/${facts.shopId}/${facts.productOfferId}`);
  writeSnapshot(db, job.requestId, facts);
  return done("found");
}

/** The browser took the lookup and never answered; the second time in a row it is given up. Call inside `tx`. */
export function recordSilentLookup(db: LedgerDb, job: LookupBridgeJob, clock: Clock): "retry" | "failed" {
  const row = db.select({ status: bridgeJobs.status, noAnswers: bridgeJobs.noAnswers }).from(bridgeJobs).where(eq(bridgeJobs.jobId, job.jobId)).get();
  if (row?.status !== "PENDING") return "retry";
  const noAnswers = row.noAnswers + 1;
  db.update(bridgeJobs).set({ noAnswers }).where(eq(bridgeJobs.jobId, job.jobId)).run();
  if (noAnswers < SILENT_LOOKUPS_BEFORE_FAILURE) return "retry";
  closeJob(db, job.jobId, "bridge_no_answer", clock.now());
  return "failed";
}

/** True when a link submission is due: lookups always wait for links (AD-14 order of service). */
export function linkWorkDue(db: LedgerDb, now: Instant): boolean {
  const job = db.select({ one: sql`1` }).from(bridgeJobs).where(and(eq(bridgeJobs.kind, "LINK"), eq(bridgeJobs.status, "PENDING"))).get();
  if (job !== undefined) return true;
  const due = db
    .select({ one: sql`1` })
    .from(linkRequests)
    .where(and(eq(linkRequests.status, "QUEUED"), eq(linkRequests.origin, "REQUEST"), or(isNull(linkRequests.nextAttemptAt), lte(linkRequests.nextAttemptAt, now))))
    .get();
  return due !== undefined;
}
