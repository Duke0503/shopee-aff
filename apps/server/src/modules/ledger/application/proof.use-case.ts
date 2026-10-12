import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import {
  findSessionCustomer,
  isStaffRole,
  parseSessionToken,
} from "../../identity";
import { proofFileName } from "../domain/bill";
import { findTransferByBillToken } from "../infrastructure/payment-transfer.repository";

/**
 * The bank screenshot behind a payout. It usually shows the full account and
 * the account holder's name, so it is not part of the public bill: only the
 * customer it was sent to, or staff, may see it.
 *
 * Every refusal looks the same on purpose — no bill, not yours, not signed in
 * — so a wrong guess learns nothing about which bills exist.
 */
export interface ProofRequest {
  billToken: string;
  cookie: string | null;
  nowIso: string;
}

/** The proof file name to serve, or null when the caller may not have it. */
export function proofForViewer(db: Db, input: ProofRequest): string | null {
  const transfer = findTransferByBillToken(db, input.billToken);
  if (!transfer) return null;

  const fileName = proofFileName(transfer.proofImage);
  if (fileName === "") return null;

  const token = parseSessionToken(input.cookie);
  const viewerId = token ? findSessionCustomer(db, token, input.nowIso) : null;
  if (!viewerId) return null;

  if (viewerId !== transfer.customerId) {
    const viewer =
      db
        .select({ role: customers.role })
        .from(customers)
        .where(eq(customers.customerId, viewerId))
        .get() ?? null;
    if (!viewer || !isStaffRole(viewer.role)) return null;
  }

  return fileName;
}
