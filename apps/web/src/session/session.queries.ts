/**
 * The customer session (AD-18, Story 7.2): who is signed in, sign-in and sign-out on
 * `/api/session`. The token lives only in the HttpOnly customer cookie; the website sees the
 * customer code. A 401 means "not signed in" and is never retried. When it says a new password
 * from /matkhau ended the session, the website keeps that fact itself (this tab's session storage
 * and the query cache), because the server says it only once and clears the cookie: the sentence
 * stays on every page until the customer signs in again or dismisses it.
 */
import { CUSTOMER_SESSION_PATH, customerSessionResponseSchema, type CustomerSessionResponse, type CustomerSignInRequest } from "@cashback/contracts";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { ApiError, apiRequest, isUnauthorized } from "../api/api.queries";

export const SESSION_KEY = ["customer", "session"] as const;
export const SESSION_ENDED_KEY = ["customer", "session-ended"] as const;
const ENDED_STORAGE = "cashback.session-ended";

/** True when the session answer says a new password ended it (AC5). */
export const endedByNewPassword = (error: unknown): boolean => error instanceof ApiError && error.messageKey === "error.session_ended_new_password";

function storedEnded(): boolean {
  try {
    return window.sessionStorage.getItem(ENDED_STORAGE) === "1";
  } catch {
    return false;
  }
}

function setEnded(client: QueryClient, ended: boolean): void {
  try {
    if (ended) window.sessionStorage.setItem(ENDED_STORAGE, "1");
    else window.sessionStorage.removeItem(ENDED_STORAGE);
  } catch {
    // Private windows may refuse storage; the query cache still holds it for this page.
  }
  client.setQueryData(SESSION_ENDED_KEY, ended);
}

export function useCustomerSession() {
  const client = useQueryClient();
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }): Promise<CustomerSessionResponse> => {
      try {
        return customerSessionResponseSchema.parse(await apiRequest(CUSTOMER_SESSION_PATH, { signal }));
      } catch (error) {
        if (endedByNewPassword(error)) setEnded(client, true);
        throw error;
      }
    },
    retry: (failures, error) => !isUnauthorized(error) && failures < 1,
    staleTime: 60_000,
  });
}

/** Whether to show "the session ended because of a new password", and the way to dismiss it. */
export function useSessionEnded(): { readonly ended: boolean; readonly dismiss: () => void } {
  const client = useQueryClient();
  const ended = useQuery({ queryKey: SESSION_ENDED_KEY, queryFn: storedEnded, initialData: storedEnded, staleTime: Infinity }).data;
  return { ended, dismiss: () => setEnded(client, false) };
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CustomerSignInRequest): Promise<CustomerSessionResponse> => customerSessionResponseSchema.parse(await apiRequest(CUSTOMER_SESSION_PATH, { method: "POST", body })),
    onSuccess: (session) => {
      setEnded(client, false);
      client.setQueryData(SESSION_KEY, session);
    },
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await apiRequest(CUSTOMER_SESSION_PATH, { method: "DELETE" });
    },
    // Back to no session: the cached one is dropped and the open pages ask the server again.
    onSuccess: () => void client.resetQueries({ queryKey: SESSION_KEY }),
  });
}
