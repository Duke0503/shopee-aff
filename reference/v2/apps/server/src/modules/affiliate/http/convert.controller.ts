import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Post, Query } from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { linkRequests } from "../../../shared/database/schema";
import { findCustomerIdByAnyId, nowLocalIso } from "../../identity";
import { decideRequestLink, type ExistingRequest } from "../application/request-link.use-case";
import { DEFAULT_ATTRIBUTION_DAYS } from "../domain/reuse-policy";
import { newRequestId } from "../domain/request-id";
import { attachAffiliateUrl, recordLinkRequest } from "../infrastructure/link-request.repository";
import { platformForUrl } from "../infrastructure/shop-hosts";
import { PROVIDER_REGISTRY, type ProviderRegistry } from "../providers/provider.registry";

/** The guest account: a web visitor we don't know. Its commission is ours. */
export const HOUSE_CUSTOMER_ID = "HOUSE";

interface ConvertBody {
  url?: string;
  customerId?: string;
}

@Controller("api/shopee")
export class ConvertController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PROVIDER_REGISTRY) private readonly providers: ProviderRegistry,
  ) {}

  /** Paste a product link, get a link back (or a request to poll for). */
  @Post("convert")
  async convert(@Body() body: ConvertBody) {
    const url = (body?.url ?? "").trim();
    if (url === "") throw new BadRequestException("url is required");

    const matched = body?.customerId ? findCustomerIdByAnyId(this.db, body.customerId) : null;
    const customerId = matched ?? HOUSE_CUSTOMER_ID;
    const isHouse = customerId === HOUSE_CUSTOMER_ID;

    const rows = this.db
      .select()
      .from(linkRequests)
      .where(eq(linkRequests.customerId, customerId))
      .all();
    const existing: ExistingRequest[] = rows.map((row) => ({
      requestId: row.requestId,
      customerId: row.customerId,
      sourceUrl: row.sourceUrl,
      status: row.status,
      createdAt: row.createdAt,
    }));

    const decision = decideRequestLink(
      { sourceUrls: [url], customerId, attributionDays: DEFAULT_ATTRIBUTION_DAYS, nowIso: nowLocalIso() },
      existing,
      platformForUrl,
    );

    if (decision.kind === "reuse") {
      const row = rows.find((candidate) => candidate.requestId === decision.requestId);
      return {
        ready: Boolean(row?.affiliateUrl),
        affiliate_url: row?.affiliateUrl ?? null,
        request_id: decision.requestId,
        house: isHouse,
      };
    }
    if (decision.kind === "new") {
      const requestId = newRequestId();
      recordLinkRequest(this.db, {
        requestId,
        customerId,
        sourceUrl: url,
        platform: decision.platform,
        createdAt: nowLocalIso(),
      });
      const affiliateUrl = await this.makeLink(url, customerId, requestId);
      return { ready: affiliateUrl !== null, affiliate_url: affiliateUrl, request_id: requestId, house: isHouse };
    }
    throw new BadRequestException("unsupported link");
  }

  /**
   * Ask the platform's provider for a link. No provider means the shop's link
   * is made asynchronously (Shopee via the extension queue); a failure leaves
   * the request pending for the notify loop to retry.
   */
  private async makeLink(url: string, customerId: string, requestId: string): Promise<string | null> {
    const provider = this.providers.forUrl(url);
    if (!provider) return null;
    try {
      const link = await provider.createAffiliateLink(url, customerId, requestId);
      attachAffiliateUrl(this.db, requestId, link.url);
      return link.url;
    } catch {
      return null;
    }
  }

  /** Poll for a link that was still being made. */
  @Get("link-status")
  linkStatus(@Query("request_id") requestId?: string) {
    if (!requestId) throw new BadRequestException("request_id is required");
    const row = this.db
      .select()
      .from(linkRequests)
      .where(eq(linkRequests.requestId, requestId))
      .get();
    if (!row) throw new NotFoundException("unknown request");
    return {
      ready: Boolean(row.affiliateUrl),
      affiliate_url: row.affiliateUrl ?? null,
      status: row.status,
      notified_at: row.notifiedAt,
    };
  }
}
