import { Controller, Get, Inject, Param, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { MESSAGES, type Messages } from "../../../notifications";
import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { billForToken } from "../application/bill.use-case";
import { isLegacyBillNumber } from "../domain/bill";
import { renderBill, renderBillNotFound, renderBillSignIn } from "../template/bill.template";

const HTML = "text/html; charset=utf-8";

/**
 * The public bill at `/b/<bill_token>`. Anyone holding the link may read the
 * receipt — that is what the link is for — but only by its unguessable token,
 * never by the row number, which a stranger could simply count up to. The
 * proof image is not here: it needs the customer signed in (`/api/proofs`).
 */
@Controller("b")
export class BillController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MESSAGES) private readonly messages: Messages,
  ) {}

  @Get(":billToken")
  bill(@Param("billToken") billToken: string, @Res() reply: FastifyReply): void {
    // An old numbered link is answered with "please sign in", not the receipt.
    if (isLegacyBillNumber(billToken)) {
      reply.code(200).type(HTML).send(renderBillSignIn(this.messages));
      return;
    }
    const bill = billForToken(this.db, billToken);
    if (!bill) {
      reply.code(404).type(HTML).send(renderBillNotFound(this.messages));
      return;
    }
    reply.code(200).type(HTML).send(renderBill(this.messages, bill));
  }
}
