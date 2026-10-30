import { randomBytes } from "node:crypto";

/**
 * The rules behind the public bill: the receipt a customer opens at
 * `/b/<bill_token>`. Pure TypeScript — no database, no framework — so the
 * format of a bill can be read (and tested) on its own.
 */

/**
 * The unguessable reference in a bill link: 24 random bytes (192 bits), URL
 * safe. The row number is guessable and the bill shows a name, an account
 * number and a proof image, so this is the only way in.
 */
export function createBillToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The reference a receipt shows when the owner typed none of their own. */
export function billReference(transferCode: string | null, id: number): string {
  const typed = (transferCode ?? "").trim();
  return typed !== "" ? typed : `DP${String(id).padStart(5, "0")}`;
}

/** `2026-10-12T08:30:05` -> `12/10/2026 08:30`, the way a receipt reads. */
export function billTime(createdAt: string): string {
  const [date = "", time = ""] = createdAt.split("T");
  const [year = "", month = "", day = ""] = date.split("-");
  const [hour = "", minute = ""] = time.split(":");
  if (year === "" || month === "" || day === "") return createdAt.slice(0, 16);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/**
 * A bill link that is just a number. The old links looked like that, and a
 * stranger could count up to one; they are answered with "please sign in"
 * instead of the receipt.
 */
export const isLegacyBillNumber = (value: string): boolean => /^\d+$/.test(value);

const PROOF_MARKER = "/uploads/proofs/";

/**
 * The file name inside a stored proof URL, or "" when the proof is not one of
 * ours (a Google Drive link, an empty field). Any name that could escape the
 * proofs folder — a separator, `..`, nothing at all — is refused here, so the
 * caller only ever gets a plain file name.
 */
export function proofFileName(rawUrl: string | null): string {
  const value = (rawUrl ?? "").trim();
  if (value === "") return "";
  const [path = ""] = value.split(/[?#]/);
  const at = path.lastIndexOf(PROOF_MARKER);
  if (at === -1) return "";
  let name = path.slice(at + PROOF_MARKER.length);
  try {
    name = decodeURIComponent(name);
  } catch {
    return "";
  }
  if (name === "" || name === "." || name === "..") return "";
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return "";
  return name;
}
