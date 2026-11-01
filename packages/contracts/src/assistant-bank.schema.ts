/**
 * A bank account saved from the Zalo chat (AD-15, AD-17, AD-23, FR-10, D26, M-7, INV-5, NFR-6;
 * Story 6.9), on the internal listener only with `X-Assistant-Token`:
 *
 *   POST /internal/assistant/bank-accounts   the details one sender wrote after `/stk`
 *
 * The details are "<bank> <number> <holder>" as the customer typed them (the number first is read
 * too, as customers of the live assistant wrote it). The server reads them, matches the bank to
 * the VietQR list and saves the account; nothing is saved in the group, and the details sent from
 * the group never leave the assistant. The answer names the bank and the last four digits only,
 * never the number or the holder. A rule broken is named by `rule`, a bank that matches several
 * VietQR banks lists them to choose from (nothing is saved then).
 */
import { z } from "zod";

import { ASSISTANT_CHATS } from "./assistant-chat.schema";

export const ASSISTANT_BANK_PATH = "/internal/assistant/bank-accounts";

/** Longer than any bank, number and holder written together. */
export const BANK_DETAILS_MAX_LENGTH = 200;
/** The most VietQR banks a reply lists to choose from. */
export const BANK_CHOICES_MAX = 5;

const zaloUserId = z.string().regex(/^[A-Za-z0-9]{1,40}$/);
const displayName = z.string().trim().max(120).nullable().optional();
const customerCode = z.string().regex(/^DP\d{5,}$/);

/**
 * `quoted`: the details came as a reply in the private chat, not after `/stk`. They are saved only
 * when they name a VietQR bank (one, or a choice) and an account number; anything else is
 * `not_bank_details` and the assistant answers it as any other message.
 */
export const assistantBankSaveSchema = z.strictObject({ zaloUserId, displayName, chat: z.enum(ASSISTANT_CHATS), details: z.string().max(BANK_DETAILS_MAX_LENGTH), quoted: z.boolean().optional() });
export type AssistantBankSave = z.infer<typeof assistantBankSaveSchema>;

/**
 * Why details were refused: `format` (no bank, number or holder to tell apart), `number` (not 4 to
 * 30 letters and digits after removing spaces and dashes), `holder` (no name in letters), `bank`
 * (no VietQR bank has that name).
 */
export const BANK_DETAIL_RULES = ["format", "number", "holder", "bank"] as const;
export type BankDetailRule = (typeof BANK_DETAIL_RULES)[number];

export const assistantBankReplySchema = z.discriminatedUnion("kind", [
  /** Saved; `changed` when it replaced another account (a change message follows by notification). */
  z.object({ kind: z.literal("saved"), bankName: z.string().max(120), lastFour: z.string().regex(/^[A-Z0-9]{4}$/), changed: z.boolean() }),
  /** The bank name matches several VietQR banks: their short names, nothing saved. */
  z.object({ kind: z.literal("choose_bank"), banks: z.array(z.string().max(120)).min(2).max(BANK_CHOICES_MAX) }),
  z.object({ kind: z.literal("invalid"), rule: z.enum(BANK_DETAIL_RULES) }),
  /** Sent in the group: refused with the pointer to the private chat, nothing read or stored. */
  z.object({ kind: z.literal("private_only") }),
  z.object({ kind: z.literal("not_registered") }),
  z.object({ kind: z.literal("contact_admin") }),
  z.object({ kind: z.literal("none") }),
  /** A quoted reply that is not bank details after all: nothing saved, nothing to say about a bank. */
  z.object({ kind: z.literal("not_bank_details") }),
]);
export type AssistantBankReply = z.infer<typeof assistantBankReplySchema>;

export const assistantBankAnswerSchema = z.object({ registered: z.boolean(), customerCode: customerCode.nullable(), reply: assistantBankReplySchema });
export type AssistantBankAnswer = z.infer<typeof assistantBankAnswerSchema>;
