import { Controller, Get, Inject, Param, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { nowLocalIso } from "../../identity";
import { findByShareCode } from "../infrastructure/link-request.repository";
import { recordClick } from "../infrastructure/link-click.repository";
import { renderSharePage } from "../template/share-page.template";

const PREVIEW_BOT = /bot|crawl|spider|facebookexternalhit|telegrambot|preview/i;

@Controller("s")
export class ShareController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The product page. Everyone sees it (only the buy button leaves for Shopee). */
  @Get(":code")
  page(
    @Param("code") code: string,
    @Query("in_app") inApp: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const found = findByShareCode(this.db, code);
    if (!found) {
      reply.code(404).send("Link not found");
      return;
    }
    const userAgent = String(request.headers["user-agent"] ?? "");
    if (!PREVIEW_BOT.test(userAgent)) {
      recordClick(this.db, found.requestId, inApp === "1" ? "in_app" : "browser", nowLocalIso());
    }
    reply
      .type("text/html; charset=utf-8")
      .send(
        renderSharePage({
          productName: found.estimateDetail ? productName(found.estimateDetail) : "",
          cashbackFormatted: "",
          buyHref: `/s/${code}/go`,
        }),
      );
  }

  /** The buy button: log the click, then send the visitor on to Shopee. */
  @Get(":code/go")
  go(@Param("code") code: string, @Res() reply: FastifyReply) {
    const found = findByShareCode(this.db, code);
    if (!found) {
      reply.code(404).send("Link not found");
      return;
    }
    recordClick(this.db, found.requestId, "buy", nowLocalIso());
    reply.code(302).header("Location", found.affiliateUrl ?? "/").send();
  }
}

function productName(estimateDetail: string): string {
  try {
    const parsed = JSON.parse(estimateDetail) as { name?: string };
    return parsed.name ?? "";
  } catch {
    return "";
  }
}
