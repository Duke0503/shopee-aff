/**
 * The staff session (AD-18, Story 4.2): who is signed in, sign-in and sign-out on
 * `/api/admin/session`. The token lives only in the HttpOnly staff cookie; the desk sees the
 * staff id, name and role. A 401 means "not signed in" and is never retried.
 */
import { staffSessionResponseSchema, type StaffSessionResponse, type StaffSignInRequest } from "@cashback/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest, isUnauthorized } from "../api/api.queries";

export const SESSION_KEY = ["admin", "session"] as const;
const SESSION_PATH = "/api/admin/session";

export function useStaffSession(options: { readonly refetchOnMount?: "always" } = {}) {
  return useQuery({
    ...options,
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }): Promise<StaffSessionResponse> => staffSessionResponseSchema.parse(await apiRequest(SESSION_PATH, { signal })),
    retry: (failures, error) => !isUnauthorized(error) && failures < 1,
    staleTime: 60_000,
  });
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: StaffSignInRequest): Promise<StaffSessionResponse> => staffSessionResponseSchema.parse(await apiRequest(SESSION_PATH, { method: "POST", body })),
    onSuccess: (session) => client.setQueryData(SESSION_KEY, session),
  });
}

/**
 * Sign-out on the server. The caller leaves the desk and then drops the cached data
 * (desk-layout.tsx); a failed sign-out changes nothing on screen but the error line.
 */
export function useSignOut() {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await apiRequest(SESSION_PATH, { method: "DELETE" });
    },
  });
}
