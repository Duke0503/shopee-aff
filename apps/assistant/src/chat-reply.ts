/**
 * Answering what a person writes (AD-15, FR-1, FR-8, D6, D10, D25; Stories 6.2 and 6.3).
 *
 * A private message registers its sender through the server (the only way a customer is made,
 * D10), in the one call it makes: the link request for a message with a link, the registration
 * otherwise. A new person gets the welcome with their customer code. A known person who writes
 * without a link is asked for one at most once a Vietnam day; otherwise the assistant stays
 * silent and staff answer. A group message is read only when it carries a link, and then only a
 * product link the server supports registers its sender (D25): joining the group, or chatting in
 * it, registers no one. A link to no shop at all gets no reply in the group (owner decision).
 * Group replies tag the sender. Each reply goes out in the pacer's turn. A chat command (`/id`,
 * `/sodu`, `/donhang`, `/stk`, `/help`) without a link is answered in both chats (chat-command.ts,
 * Story 6.7); a link in the same message wins, as it did live.
 *
 * A link is asked for once, for the sender alone (the server queues it under the sender's own
 * customer id, so it carries their sub_id1), before the welcome is sent, so the wait for the link
 * runs while the welcome is paced. The assistant waits on the server, polling the reply facts, for
 * at most `replyWaitMs`: once the share link is made and the product facts are in (or will not
 * come) the reply is sent; when the wait ends with the link made but no facts, it is sent without
 * an estimate; with no link yet, or when the server could not be asked, the sender is told it is
 * on its way, and the link follows later by notification (Story 6.5). A request that failed is
 * told by the server's own `link_failed` notification, so nothing is sent for it here.
 *
 * A link goes out once (Story 6.5); the server's claim decides who hands it over. The assistant
 * claims it in the reply's own pacer turn, right before the Zalo send, so a long pacer queue never
 * outlives the claim: `claimed` holds it for 2 minutes, the reply is sent and then confirmed,
 * which makes it DELIVERED; a reply that could not be sent releases the claim, and a
 * claim never confirmed (the assistant stopped) lapses, so the server's delivery check sends the
 * link by notification instead of losing it. `pending` (a notification is on its way) and a claim
 * the server did not answer send "on its way" and no link, so the link is never sent twice.
 * `delivered` sends the link again only for the same product asked again (the request reused).
 */
import { toMs, vnDateOf, type Clock } from "@cashback/core";
import { DISPLAY_NAME_MAX_LENGTH, type AssistantChat, type AssistantLinkReply, type LINK_CLAIMS } from "@cashback/contracts";

type LinkClaim = (typeof LINK_CLAIMS)[number];

import { answerCommand, commandOf } from "./chat-command";
import type { InternalApi } from "./internal-api.adapter";
import { linkReplyMessage, refusalMessage, type ReplyMessage } from "./link-reply-text";
import { extractFirstUrl } from "./message-parse";
import type { MessageKey } from "./messages";
import type { Sleep } from "./pacer";
import type { ChatTarget, IncomingMessage } from "./zalo.port";

/** How long a reply waits for its link on the server; the pacer's delay comes on top (AC1: under 30 s). */
export const REPLY_WAIT_MS = 16_000;
export const REPLY_POLL_MS = 2_000;
/** Tries of the confirm after a sent reply, before the claim is left to lapse. */
const CONFIRM_TRIES = 3;

/** The person a group reply tags. */
export interface Tag {
  readonly userId: string;
  readonly name: string;
}

export type ChatSend = (target: ChatTarget, key: MessageKey, values?: Readonly<Record<string, string | number>>, tag?: Tag | null) => Promise<void>;

/**
 * Sends one message whose words are decided only when the pacer grants its turn, right before the
 * Zalo send; `decide` answering null sends nothing in that turn.
 */
export type ChatSendWhenDue = (target: ChatTarget, decide: () => Promise<ReplyMessage | null>, tag?: Tag | null) => Promise<void>;

export interface ChatReplyDeps {
  readonly api: InternalApi;
  readonly clock: Clock;
  readonly sleep: Sleep;
  /** Sends one message by key in the pacer's turn; a tag is written in front of a group message. */
  readonly send: ChatSend;
  readonly sendWhenDue: ChatSendWhenDue;
  readonly replyWaitMs?: number;
  readonly pollMs?: number;
}

type Made = AssistantLinkReply & { readonly shareUrl: string };
const isMade = (reply: AssistantLinkReply): reply is Made => reply.shareUrl !== null && reply.status !== "FAILED";

/** The sender's Zalo name as the server keeps it: trimmed and cut, never refused for its length. */
export function displayNameOf(message: IncomingMessage): string | null {
  const name = (message.senderName ?? "").trim().slice(0, DISPLAY_NAME_MAX_LENGTH).trim();
  return name === "" ? null : name;
}

/**
 * Polls the reply facts until they are complete or the wait ends; null when no link was made in
 * time. A poll the server does not answer is tried again on the next step, not given up on.
 */
async function awaitReply(deps: ChatReplyDeps, requestId: string, customerId: string): Promise<Made | "failed" | null> {
  const deadline = toMs(deps.clock.now()) + (deps.replyWaitMs ?? REPLY_WAIT_MS);
  let made: Made | null = null;
  for (;;) {
    const last = await deps.api.linkReply({ requestId, customerId }).catch(() => null);
    if (last?.status === "FAILED") return "failed";
    if (last !== null && isMade(last)) {
      if (last.factsSettled) return last;
      made = last;
    }
    const left = deadline - toMs(deps.clock.now());
    if (left <= 0) return made;
    await deps.sleep(Math.min(deps.pollMs ?? REPLY_POLL_MS, left));
  }
}

/** Starts a send now and hands back its outcome later, so the link wait runs while it is paced. */
function started(send: Promise<void> | null): () => Promise<void> {
  if (send === null) return async () => undefined;
  const outcome = send.then(
    () => null,
    (error: unknown) => ({ error }),
  );
  return async () => {
    const failed = await outcome;
    if (failed !== null) throw failed.error;
  };
}

async function answerLink(deps: ChatReplyDeps, message: IncomingMessage, url: string, chat: AssistantChat): Promise<void> {
  const name = displayNameOf(message);
  const tag = chat === "group" && name !== null ? { userId: message.senderId, name } : null;
  const answer = await deps.api.requestLink({ zaloUserId: message.senderId, displayName: name, chat, url });
  const welcomed = started(chat === "private" && answer.registered ? deps.send(message.chat, "welcome", { customerCode: answer.customerCode ?? "" }) : null);
  if (answer.outcome === "refused") {
    await welcomed();
    const key = refusalMessage(answer.reason, chat);
    return key === null ? undefined : deps.send(message.chat, key, {}, tag);
  }
  const reply = await awaitReply(deps, answer.requestId, answer.customerId);
  await welcomed();
  if (reply === "failed") return;
  if (reply === null) return deps.send(message.chat, "link_on_its_way", {}, tag);
  return handOver(deps, message.chat, tag, { requestId: answer.requestId, customerId: answer.customerId }, reply, answer.reused);
}

/** Sends a made link in the reply only when the server's claim gives it to the reply (Story 6.5). */
async function handOver(deps: ChatReplyDeps, chat: ChatTarget, tag: Tag | null, request: { requestId: string; customerId: string }, reply: Made, reused: boolean): Promise<void> {
  let claim: LinkClaim | null = null;
  // The claim is taken in the send's own turn, so its 2 minutes start right before the send.
  const decide = async (): Promise<ReplyMessage | null> => {
    claim = (await deps.api.claimLink(request).catch(() => null))?.claim ?? null;
    if (claim === null || claim === "pending" || claim === "not_made") return { key: "link_on_its_way", values: {} };
    if (claim === "delivered" && !reused) return null;
    return linkReplyMessage(reply);
  };
  try {
    await deps.sendWhenDue(chat, decide, tag);
  } catch (error) {
    if (claim === "claimed") await deps.api.releaseLink(request).catch(() => false);
    throw error;
  }
  if (claim !== "claimed") return;
  for (let tries = 1; tries <= CONFIRM_TRIES; tries++) {
    if (await deps.api.confirmLink(request).then(() => true, () => false)) return;
    if (tries < CONFIRM_TRIES) await deps.sleep(deps.pollMs ?? REPLY_POLL_MS);
  }
}

/** Answers each message; remembers which known people were asked for a link today. */
export function chatReplier(deps: ChatReplyDeps): (message: IncomingMessage) => Promise<void> {
  let day = "";
  const askedToday = new Set<string>();
  const askOnceToday = async (message: IncomingMessage): Promise<void> => {
    const today = vnDateOf(deps.clock.now());
    if (today !== day) {
      day = today;
      askedToday.clear();
    }
    if (askedToday.has(message.senderId)) return;
    askedToday.add(message.senderId);
    await deps.send(message.chat, "send_a_link");
  };
  return async (message) => {
    const url = extractFirstUrl(message.text);
    const command = url === null ? commandOf(message.text) : null;
    if (command !== null) return answerCommand(deps, message, command, displayNameOf(message));
    if (message.chat.kind === "group") {
      if (url !== null) await answerLink(deps, message, url, "group");
      return;
    }
    if (url !== null) return answerLink(deps, message, url, "private");
    const person = await deps.api.register({ zaloUserId: message.senderId, displayName: displayNameOf(message) });
    if (person.created) return deps.send(message.chat, "welcome", { customerCode: person.customerCode ?? "" });
    await askOnceToday(message);
  };
}
