import { z } from "zod";

export const CustomerRole = z.enum(["user", "admin", "employee", "house"]);
export type CustomerRole = z.infer<typeof CustomerRole>;

/** A DP code: "DP" plus five digits, e.g. DP00012. Staff and HOUSE have none. */
export const CustomerCode = z.string().regex(/^DP\d{5}$/);

export const Customer = z.object({
  customerId: z.string().min(1),
  customerCode: CustomerCode.nullable().optional(),
  role: CustomerRole,
  zaloUserId: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  hasBankDetails: z.boolean().optional(),
});
export type Customer = z.infer<typeof Customer>;

export const isHouse = (customer: Pick<Customer, "role">): boolean => customer.role === "house";
export const isStaff = (customer: Pick<Customer, "role">): boolean =>
  customer.role === "admin" || customer.role === "employee";
