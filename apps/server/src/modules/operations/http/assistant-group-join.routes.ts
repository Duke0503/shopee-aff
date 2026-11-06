/**
 * Members who joined the Zalo group (D64).
 *
 *   POST /internal/assistant/group-joins   internal listener only, `X-Assistant-Token`
 *
 * One Telegram message per member goes to the DP Business group, after the read and outside any
 * transaction. Nothing is stored, and joining registers no one (D25). Without the bot or the group's
 * chat nothing is sent. A failed send is logged by name and not retried; the answer counts the sent.
 */
import { ASSISTANT_GROUP_JOIN_PATH, assistantGroupJoinSchema, assistantGroupJoinSentSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance } from "fastify";

import { customerTotal } from "../../identity/index";
import type { Ledger } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../../../platform/http/internal-token.guard";
import { memberJoinedText } from "../member-joined-notice.query";

export interface AssistantGroupJoinRouteDeps {
  readonly ledger: Pick<Ledger, "tx">;
  readonly clock: Clock;
  /** Bound to the DP Business group's chat; null without the bot or the chat. */
  readonly sender: { send(text: string): Promise<void> } | null;
}

export function assistantGroupJoinRoutes(deps: AssistantGroupJoinRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.post(ASSISTANT_GROUP_JOIN_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantGroupJoinSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const { sender } = deps;
      if (sender === null) return assistantGroupJoinSentSchema.parse({ sent: 0 });
      const totalCustomers = deps.ledger.tx((db) => customerTotal(db));
      const at = deps.clock.now();
      let sent = 0;
      for (const member of body.data.members) {
        try {
          await sender.send(memberJoinedText({ name: member.name, userId: member.userId, groupName: body.data.groupName, memberCount: body.data.memberCount, totalCustomers, at }));
          sent++;
        } catch (error) {
          const status = (error as { status?: unknown } | null)?.status;
          request.log.warn({ error: error instanceof Error ? error.name : "unknown", ...(typeof status === "number" ? { status } : {}) }, "operations.member_joined.delivery_failed");
        }
      }
      return assistantGroupJoinSentSchema.parse({ sent });
    });
  };
}
