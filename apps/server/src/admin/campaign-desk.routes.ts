/**
 * The campaign screen on the admin desk (FR-23, AD-11, D22, D53; Story 4.20 after cutover). Admin
 * only (ADMIN_ONLY_PATHS). The list reads every campaign with its awards and, for a campaign with
 * a window, the Overview's own events figures (`eventsOf`: the bonus spent, the commission of its
 * orders, the operator's share and the event's result), so the two screens agree to the dong.
 * Create is the CLI's command: preview writes nothing, create re-checks inside its transaction and
 * writes the audit entry.
 *
 *   GET  /api/admin/campaigns            every campaign, its state, slots, awards and result
 *   POST /api/admin/campaigns/preview    the campaign as it would be stored, or the refusal
 *   POST /api/admin/campaigns            create it
 *
 * Stopping a campaign early has no command yet (its slot rules wait for Story 9.4); the list shows
 * a closed campaign (one that takes no awards) as CLOSED.
 */
import { CAMPAIGN_AWARDS_SHOWN, deskCampaignPreviewSchema, deskCampaignRequestSchema, deskCampaignsSchema, type CampaignState, type DeskCampaign, type DeskCampaigns, type OverviewEvent } from "@cashback/contracts";
import { formatVnDate, formatVnTime, parseInstant, type Clock, type Instant } from "@cashback/core";

import { campaignList, createCampaign, latestAwards, previewCampaign, type CampaignListRow } from "../modules/campaigns/index";
import { customerCardsOf, guestCustomerIds } from "../modules/identity/index";
import { commandAudit } from "../modules/operations/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { StaffRoutes } from "../platform/http/staff-routes";
import { staffActorOf } from "../platform/ports/staff-session.port";
import { campaignAnswer, campaignInput, refusal } from "./admin-command.routes";
import { eventsOf } from "./overview-business.query";

export interface CampaignDeskRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

export function campaignState(c: CampaignListRow, slotsUsed: number, now: string): CampaignState {
  if (!c.acceptsAwards) return "CLOSED";
  if (c.endsAt !== null && c.endsAt <= now) return "ENDED";
  if (c.startsAt !== null && c.startsAt > now) return "UPCOMING";
  return slotsUsed >= c.slots ? "FULL" : "RUNNING";
}

/** The events figures of every campaign with a window, read over the span of all their windows. */
function resultsOf(db: LedgerDb, rows: readonly CampaignListRow[]): Map<string, OverviewEvent> {
  const windows = rows.filter((c) => c.startsAt !== null && c.endsAt !== null);
  if (windows.length === 0) return new Map();
  const from = windows.map((c) => c.startsAt ?? "").reduce((a, b) => (a < b ? a : b));
  const to = windows.map((c) => c.endsAt ?? "").reduce((a, b) => (a > b ? a : b));
  const events = eventsOf(db, { from: parseInstant(from), to: parseInstant(to) }, new Set(guestCustomerIds(db)));
  return new Map(events.map((e) => [e.campaignId, e]));
}

export function deskCampaigns(db: LedgerDb, clock: Clock): DeskCampaigns {
  const now = clock.now();
  const rows = campaignList(db);
  const results = resultsOf(db, rows);
  const latest = latestAwards(db, rows.map((c) => c.campaignId), CAMPAIGN_AWARDS_SHOWN);
  const cards = customerCardsOf(db, [...latest.values()].flat().map((a) => a.customerId));
  const campaigns = rows.map((c): DeskCampaign => {
    const slotsUsed = c.awards.HELD + c.awards.CONFIRMED + c.awards.PAID;
    const e = results.get(c.campaignId);
    return {
      campaignId: c.campaignId,
      name: c.name,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      endsBefore: c.endsAt === null ? null : { time: formatVnTime(c.endsAt as Instant), date: formatVnDate(c.endsAt as Instant, clock) },
      slots: c.slots,
      bonus: c.bonus,
      minOrderValue: c.minOrderValue,
      platforms: [...c.platforms],
      perCustomer: c.perCustomer,
      state: campaignState(c, slotsUsed, now),
      awards: { held: c.awards.HELD, confirmed: c.awards.CONFIRMED, paid: c.awards.PAID, void: c.awards.VOID },
      slotsUsed,
      result: e === undefined ? null : { cost: e.bonus, commission: e.commission, operatorShare: e.operatorShare, result: e.result },
      latest: (latest.get(c.campaignId) ?? []).map((a) => ({ awardId: a.awardId, orderId: a.orderId, customerCode: cards.get(a.customerId)?.customerCode ?? null, customerName: cards.get(a.customerId)?.displayName ?? null, createdAt: a.createdAt, status: a.status })),
    };
  });
  return { asOf: now, campaigns };
}

function parsedCampaign(body: unknown) {
  const result = deskCampaignRequestSchema.safeParse(body);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data.campaign;
}

export function campaignDeskRoutes({ ledger, clock }: CampaignDeskRouteDeps): StaffRoutes {
  return (add) => {
    add({ method: "GET", url: "/api/admin/campaigns", adminOnly: true, handler: async () => deskCampaignsSchema.parse(ledger.sqlite.transaction(() => deskCampaigns(ledger.db, clock)).deferred()) });
    add({
      method: "POST",
      url: "/api/admin/campaigns/preview",
      adminOnly: true,
      handler: async (request) => {
        const campaign = parsedCampaign(request.body);
        try {
          return deskCampaignPreviewSchema.parse(campaignAnswer(previewCampaign(ledger.db, campaignInput(ledger.db, campaign)), clock));
        } catch (error) {
          throw refusal(error);
        }
      },
    });
    add({
      method: "POST",
      url: "/api/admin/campaigns",
      adminOnly: true,
      handler: async (request, _reply, context) => {
        const campaign = parsedCampaign(request.body);
        if (context.staff === null) throw new HttpError("unauthorized", "error.unauthorized");
        const actor = staffActorOf(context.staff);
        try {
          const created = ledger.tx((db) => createCampaign(db, campaignInput(db, campaign), { clock, by: commandAudit(db, clock, actor) }));
          return deskCampaignPreviewSchema.parse(campaignAnswer(created, clock));
        } catch (error) {
          throw refusal(error);
        }
      },
    });
  };
}
