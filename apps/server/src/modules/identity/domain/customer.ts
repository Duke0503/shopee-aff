/**
 * The Customer identity: who a person is and what kind of account they hold.
 * Pure rules — no database, no framework. Mirrors the roles in ADR/glossary.
 */
export type CustomerRole = "user" | "admin" | "employee" | "house";

export interface CustomerRef {
  role: CustomerRole;
}

/** HOUSE is the guest account: 0đ cashback, no payout, no messages. */
export const isHouse = (customer: CustomerRef): boolean => customer.role === "house";

/** Staff never win campaign slots (the owner's rules). */
export const isStaff = (customer: CustomerRef): boolean =>
  customer.role === "admin" || customer.role === "employee";

/** A normal, cashback-earning customer. */
export const isUser = (customer: CustomerRef): boolean => customer.role === "user";
