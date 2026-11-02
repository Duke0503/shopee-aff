/**
 * How the website words an order line (AD-10, D57, Story 7.4): the shop's name, and for the states
 * that need a sentence (rejected, cancelled after approval, being checked) the customer sentence
 * the status registry points at in messages.json, the one source the chat notices use too
 * (docs/operations/status-flows.md). A rejected order's reason code is worded from the same file;
 * a code it has no words for reads as "the network gave no reason" here, since the chat's own
 * fallback points to this very website.
 */
import messages from "@cashback/labels/vi/messages.json";
import { statusesOf } from "@cashback/core";
import { fillLabel } from "@cashback/ui";

import { webText, type WebKey } from "../labels";

const MESSAGES: Readonly<Record<string, string>> = messages;

const PLATFORMS: Readonly<Record<string, WebKey>> = {
  shopee: "platform_shopee",
  shopeefood: "platform_shopeefood",
  tiktok: "platform_tiktok",
};

export function platformName(platform: string | null): string | null {
  const key = platform === null ? undefined : PLATFORMS[platform];
  return key === undefined ? null : webText(key);
}

/** The states whose badge alone does not say enough: the line shows the registry's sentence. */
const SENTENCE_STATES: readonly string[] = ["REJECTED", "REVERSED", "FROZEN"];

function reasonWords(code: string | null): string {
  const words = code === null || code === "other" ? undefined : MESSAGES[`rejection_reason_${code}`];
  return words ?? webText("order_reason_fallback");
}

/** The sentence a line shows under its badge, or null when the badge and the progress say it all. */
export function stateSentence(status: string, rejectionReason: string | null): string | null {
  if (!SENTENCE_STATES.includes(status)) return null;
  const key = statusesOf("order").find((s) => s.value === status)?.messageKey ?? null;
  const template = key === null ? undefined : MESSAGES[key];
  return template === undefined ? null : fillLabel(template, { reason: reasonWords(rejectionReason) });
}
