/**
 * Issuing a customer code (AD-23, FR-8): the next number above the counter that no customer and
 * no alias already holds becomes the code, and the counter moves to it in the same transaction.
 * Codes are never reused: the counter never goes down (a trigger refuses it), and a code found
 * taken (a gap the counter fell behind) is skipped and named in a warning. The audit entry is
 * written in the same transaction (AD-17). Call inside `tx`.
 */
import { eq, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { formatCustomerCode } from "./domain/customer-code";
import { customerCodeCounter } from "./schema";

export class CustomerCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerCodeError";
  }
}

function isTaken(db: LedgerDb, code: string): boolean {
  const row = db.get<{ n: number }>(
    sql`SELECT (SELECT count(*) FROM customers WHERE customer_code = ${code}) + (SELECT count(*) FROM customer_aliases WHERE alias = ${code}) AS n`,
  );
  return row.n > 0;
}

export function issueCustomerCode(db: LedgerDb, logger: Pick<Logger, "warn">, by: CommandAudit): string {
  const counter = db.select().from(customerCodeCounter).where(eq(customerCodeCounter.id, 1)).get();
  if (!counter) throw new CustomerCodeError("customer_code_counter has no row");
  const skipped: string[] = [];
  let next = counter.last + 1;
  while (isTaken(db, formatCustomerCode(next))) skipped.push(formatCustomerCode(next++));
  if (skipped.length > 0) logger.warn({ skipped }, "identity.customer_code.skipped");
  db.update(customerCodeCounter).set({ last: next }).where(eq(customerCodeCounter.id, 1)).run();
  const code = formatCustomerCode(next);
  by.audit.record({ actor: by.actor, event: "identity.customer_code.issued", entityId: code, payload: { customerCode: code, skipped: skipped.length } });
  return code;
}
