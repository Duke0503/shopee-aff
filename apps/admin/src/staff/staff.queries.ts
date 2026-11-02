/**
 * The staff screen's server calls (FR-24, Story 4.20, admin only): the accounts, adding one, a
 * role or status change and a new password. A password the server issues comes back once, in the
 * mutation's result, and is never put in the query cache; each change refreshes the list.
 */
import { staffAccessResponseSchema, staffIssuedPasswordSchema, staffListSchema, type StaffAddRequest, type StaffIssuedPassword, type StaffList } from "@cashback/contracts";
import type { StaffRole } from "@cashback/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

export const STAFF_KEY = ["admin", "staff"] as const;

export function useStaffList() {
  return useQuery({
    queryKey: STAFF_KEY,
    queryFn: async ({ signal }): Promise<StaffList> => staffListSchema.parse(await apiRequest("/api/admin/staff", { signal })),
  });
}

const memberPath = (staffId: string, step: "access" | "password"): string => `/api/admin/staff/${encodeURIComponent(staffId)}/${step}`;

export function useAddStaff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: StaffAddRequest): Promise<StaffIssuedPassword> => staffIssuedPasswordSchema.parse(await apiRequest("/api/admin/staff", { method: "POST", body })),
    onSuccess: () => client.invalidateQueries({ queryKey: STAFF_KEY }),
  });
}

export interface AccessChange {
  readonly staffId: string;
  readonly role?: StaffRole;
  readonly status?: "ACTIVE" | "DISABLED";
}

export function useChangeAccess() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ staffId, ...body }: AccessChange) => staffAccessResponseSchema.parse(await apiRequest(memberPath(staffId, "access"), { method: "POST", body })),
    onSuccess: () => client.invalidateQueries({ queryKey: STAFF_KEY }),
  });
}

export function useResetPassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (staffId: string): Promise<StaffIssuedPassword> => staffIssuedPasswordSchema.parse(await apiRequest(memberPath(staffId, "password"), { method: "POST" })),
    onSuccess: () => client.invalidateQueries({ queryKey: STAFF_KEY }),
  });
}
