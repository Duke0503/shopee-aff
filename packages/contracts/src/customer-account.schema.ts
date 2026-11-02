/**
 * The signed-in customer's account on the website (FR-10, FR-9, AD-17, AD-18, AD-23, INV-5;
 * Story 7.5). The session cookie names the customer; no call takes a customer id.
 *
 *   GET    /api/banks              the VietQR bank list the bank picker shows
 *   POST   /api/me/bank-account    save or change the bank account (held until confirmed in Zalo)
 *   DELETE /api/me/bank-account    erase the bank account
 *   POST   /api/me/password        a password the customer chooses
 *
 * The bank is sent as its VietQR BIN, picked from the list, never as free text, so the server
 * never guesses a bank. The answer names the bank, the holder and the last four digits only.
 * Written with zod/mini like every website contract (Story 7.1 AC3).
 */
import { z } from "zod/mini";

import { MAX_CUSTOMER_PASSWORD } from "./customer-session.schema";

export const BANK_LIST_PATH = "/api/banks";
export const MY_BANK_ACCOUNT_PATH = "/api/me/bank-account";
export const MY_PASSWORD_PATH = "/api/me/password";

/** A chosen password: at least 8 characters and not the customer code (FR-10). */
export const MIN_CUSTOMER_PASSWORD = 8;
/** Typed account numbers before spaces and dashes are removed; the stored rule is 4 to 30. */
export const BANK_NUMBER_INPUT_MAX = 60;
export const BANK_HOLDER_INPUT_MAX = 70;

export const bankListSchema = z.object({
  banks: z.array(z.object({ bin: z.string().check(z.regex(/^\d{6}$/)), shortName: z.string(), name: z.string() })),
});
export type BankList = z.infer<typeof bankListSchema>;
export type BankChoice = BankList["banks"][number];

export const bankAccountSaveSchema = z.strictObject({
  bankBin: z.string().check(z.regex(/^\d{6}$/)),
  accountNumber: z.string().check(z.maxLength(BANK_NUMBER_INPUT_MAX)),
  holderName: z.string().check(z.maxLength(BANK_HOLDER_INPUT_MAX)),
  /** The consent box; the server refuses anything but true. */
  consent: z.boolean(),
});
export type BankAccountSave = z.infer<typeof bankAccountSaveSchema>;

export const bankAccountSavedSchema = z.object({
  /** `unchanged`: the same account was already saved and confirmed, so nothing was written and nothing is held. */
  result: z.enum(["saved", "changed", "unchanged"]),
  bank: z.object({ bankName: z.nullable(z.string()), holderName: z.nullable(z.string()), lastFour: z.string(), held: z.boolean() }),
});
export type BankAccountSaved = z.infer<typeof bankAccountSavedSchema>;

export const bankAccountErasedSchema = z.object({ erased: z.boolean() });

export const passwordChangeSchema = z.strictObject({
  currentPassword: z.string().check(z.maxLength(MAX_CUSTOMER_PASSWORD)),
  newPassword: z.string().check(z.maxLength(MAX_CUSTOMER_PASSWORD)),
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

export const passwordChangedSchema = z.object({ changed: z.literal(true), otherSessionsEnded: z.int().check(z.minimum(0)) });
