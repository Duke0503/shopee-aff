/**
 * The per-column time conversion table (AD-24, AD-11, D45, Story 2.1). Every time column of
 * the live ledger has an entry: the zone its naive values were written in, and the writer that
 * shows it. A value with an offset (`+07:00` from the live `now()`, `+00:00` from
 * `datetime.now(timezone.utc)`) is one exact instant in any column. A naive value is read in
 * the column's zone: UTC where the writer is SQLite `datetime('now')`, Vietnam time where staff
 * typed it (campaign windows, settlement times). A column that never had a naive writer has
 * `naive: null`, so a naive value there is reported, never guessed. An import refuses to start
 * when the live ledger has a time column with no entry here.
 *
 * Evidence paths are in the live system (`src/cashback/...`, `web/...`).
 */
import type { NaiveZone } from "@cashback/core";

export type TimeRule =
  | {
      readonly kind: "instant";
      readonly naive: NaiveZone;
      /** orders.recorded_at only: a midnight `+07:00` date equal to the order SN prefix was synthesized. */
      readonly approximateFromOrderSn?: true;
      readonly evidence: string;
    }
  | { readonly kind: "not-imported"; readonly reason: string; readonly evidence: string };

/** A live column the importer treats as a time: the name says so. */
export const TIME_COLUMN_NAME = /(_at|_time|_until|_date)$|^period_(start|end)$/;

const NOW_VN = "repository.py:154-155 now() writes ISO +07:00";
const STAMP_UTC = "core/accounts.py:66-71 _stamp(datetime.now(utc)) writes ISO +00:00";
const SQLITE_NOW = "datetime('now') writes naive UTC";
const NO_DEALS = "D29 no deals: featured deals and F&B vouchers are not carried over";

const instant = (naive: NaiveZone, evidence: string): TimeRule => ({ kind: "instant", naive, evidence });

export const LIVE_TIME_TABLE: Readonly<Record<string, TimeRule>> = {
  "customers.created_at": instant("UTC", `${NOW_VN}: repository.py:759, 639, dashboard.py:4040; ${STAMP_UTC}: dashboard.py:1930-1934; ${SQLITE_NOW}: dashboard.py:3595, 3659, 3698`),
  "customers.consent_at": instant(null, `${NOW_VN}: repository.py:776-778; merge.py:89-92 copies it`),
  "customers.password_set_at": instant(null, `${STAMP_UTC}: accounts.py:124-127, 147-149, dashboard.py:1968-1969`),
  "customers.locked_until": instant(null, `${STAMP_UTC}: accounts.py:208-211`),
  "customers.last_login_at": instant(null, `${STAMP_UTC}: accounts.py:222-225; merge.py:101-102 keeps the larger`),
  "customer_aliases.created_at": instant(null, `${NOW_VN}: merge.py:124-126`),
  "link_requests.created_at": instant(null, `${NOW_VN}: repository.py:828-832`),
  "link_requests.notified_at": instant(null, `${NOW_VN}: repository.py:1309-1310, notifications.py:103-104, 265-266, 550-551`),
  "orders.recorded_at": {
    kind: "instant",
    naive: null,
    approximateFromOrderSn: true,
    evidence: "repository.py:908-915 parse_order_time writes ISO +07:00 (repository.py:158-217), falling back to the order SN prefix at 00:00+07:00 (repository.py:209-215); reconciliation.py:124-126 and accesstrade_reconciler.py:214, 315-317 store parse_order_time output",
  },
  "orders.approved_at": instant(null, `${NOW_VN}: repository.py:974-976`),
  "orders.paid_at": instant("UTC", `${NOW_VN}: repository.py:1052-1053; ${SQLITE_NOW}: dashboard.py:2575, 2580, 2908, 2936`),
  "orders.updated_at": instant("UTC", `${NOW_VN}: repository.py:915, 976, 1015, 1053, reconciliation.py:126, 139; ${SQLITE_NOW}: dashboard.py:2575, 2580, 2909, 2937`),
  "orders.settled_at": instant("VN", "repository.py:1154-1162 stores the caller's value: payout_sync.py:95, 176-182 ISO +07:00 or now(); dashboard.py:3416 a staff-typed settled_at (Vietnam time) or now()"),
  "state_history.changed_at": instant(null, `${NOW_VN}: repository.py:861-863`),
  "manual_review.created_at": instant(null, `${NOW_VN}: repository.py:1196-1198`),
  "reconciliation_runs.ran_at": instant(null, `${NOW_VN}: reconciliation.py:186-191`),
  "reconciliation_runs.period_start": instant(null, "never written: reconciliation.py:52-53 default None and no caller passes it (cli/commands/reports.py:75, 156, 280)"),
  "reconciliation_runs.period_end": instant(null, "never written: reconciliation.py:52-53 default None and no caller passes it (cli/commands/reports.py:75, 156, 280)"),
  "products_cache.first_seen_at": instant(null, `${NOW_VN}: repository.py:1455, 1501-1506`),
  "products_cache.updated_at": instant(null, `${NOW_VN}: repository.py:1455, 1482, 1506`),
  "sessions.created_at": instant(null, `${STAMP_UTC}: accounts.py:217-220`),
  "sessions.expires_at": instant(null, `${STAMP_UTC}: accounts.py:217-220, 256-257`),
  "activity_logs.created_at": instant("UTC", `${STAMP_UTC}: accounts.py:229; ${SQLITE_NOW}: dashboard.py:3588-3589, 3676-3677`),
  "payment_transfers.created_at": instant("UTC", `${SQLITE_NOW}: dashboard.py:2565-2566, 2878-2881`),
  "payment_transfers.notified_at": instant("UTC", `${SQLITE_NOW}: dashboard.py:2878-2881`),
  "group_info.updated_at": instant("UTC", `${SQLITE_NOW}: dashboard.py:3618-3619, 3642-3643`),
  "payout_batches.created_time": instant(null, "payout_sync.py:88-95 _parse_ts writes ISO +07:00, stored by repository.py:1106-1121"),
  "payout_batches.paid_time": instant(null, "payout_sync.py:88-95 _parse_ts writes ISO +07:00, stored by repository.py:1106-1121"),
  "payout_batches.created_at": instant(null, `${NOW_VN}: repository.py:1106-1121`),
  "payout_batches.updated_at": instant(null, `${NOW_VN}: repository.py:1106-1121`),
  "campaigns.starts_at": instant("VN", "staff-typed: web/src/features/Admin/views/CampaignsView.tsx:510 datetime-local, dashboard.py:2374, campaigns.py:55-58 store it as typed"),
  "campaigns.ends_at": instant("VN", "staff-typed: web/src/features/Admin/views/CampaignsView.tsx:521 datetime-local, dashboard.py:2375, campaigns.py:55-58 store it as typed"),
  "campaigns.created_at": instant(null, `${NOW_VN}: campaigns.py:55-59`),
  "campaign_awards.created_at": instant(null, `${NOW_VN}: campaigns.py:85-92, 128-129`),
  "campaign_awards.confirmed_at": instant("UTC", `${NOW_VN}: campaigns.py:106-111; ${SQLITE_NOW}: dashboard.py:2926, 2953`),
  "campaign_awards.paid_at": instant("UTC", `copies orders.paid_at (campaigns.py:105-108, naive UTC or +07:00); ${NOW_VN}: campaigns.py:222-223; ${SQLITE_NOW}: dashboard.py:2926, 2953`),
  "campaign_awards.voided_at": instant(null, `${NOW_VN}: campaigns.py:102`),
  "link_clicks.clicked_at": instant(null, `${NOW_VN}: share_links.py:80-81`),
  "system_kv.updated_at": instant(null, `${NOW_VN}: repository.py:1966-1970`),
  "telegram_order_alerts.notified_at": instant(null, `${NOW_VN}: repository.py:891-892`),
  "featured_deals.created_at": { kind: "not-imported", reason: NO_DEALS, evidence: "repository.py:1697, 1721-1725" },
  "featured_deals.updated_at": { kind: "not-imported", reason: NO_DEALS, evidence: "repository.py:1697-1725" },
  "fnb_vouchers.start_date": { kind: "not-imported", reason: NO_DEALS, evidence: "dashboard.py:5266 staff-typed date" },
  "fnb_vouchers.end_date": { kind: "not-imported", reason: NO_DEALS, evidence: "dashboard.py:5267 staff-typed date" },
  "fnb_vouchers.created_at": { kind: "not-imported", reason: NO_DEALS, evidence: "repository.py:1782-1808" },
  "fnb_vouchers.updated_at": { kind: "not-imported", reason: NO_DEALS, evidence: "repository.py:1782-1808" },
};

export function timeRule(table: string, column: string): TimeRule | undefined {
  return LIVE_TIME_TABLE[`${table}.${column}`];
}
