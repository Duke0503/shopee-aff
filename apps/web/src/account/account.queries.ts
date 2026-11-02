/**
 * The Account page's server calls (Story 7.5, code.md §10): the VietQR bank list for the picker,
 * saving and erasing the bank account and changing the password. The session cookie names the
 * customer. A bank change refreshes My money (its bank card reads the same account, LC-10).
 */
import {
  BANK_LIST_PATH,
  bankAccountErasedSchema,
  bankAccountSavedSchema,
  bankListSchema,
  MY_BANK_ACCOUNT_PATH,
  MY_PASSWORD_PATH,
  passwordChangedSchema,
  type BankAccountSave,
  type BankAccountSaved,
  type BankList,
  type PasswordChange,
} from "@cashback/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";
import { MONEY_KEY } from "../session/session.queries";

export const BANK_LIST_KEY = ["banks"] as const;

export function useBankList(enabled: boolean) {
  return useQuery({
    queryKey: BANK_LIST_KEY,
    queryFn: async ({ signal }): Promise<BankList> => bankListSchema.parse(await apiRequest(BANK_LIST_PATH, { signal })),
    staleTime: Infinity,
    enabled,
  });
}

export function useSaveBank() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: BankAccountSave): Promise<BankAccountSaved> => bankAccountSavedSchema.parse(await apiRequest(MY_BANK_ACCOUNT_PATH, { method: "POST", body })),
    onSuccess: () => void client.invalidateQueries({ queryKey: MONEY_KEY }),
  });
}

export function useEraseBank() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<boolean> => bankAccountErasedSchema.parse(await apiRequest(MY_BANK_ACCOUNT_PATH, { method: "DELETE" })).erased,
    onSuccess: () => void client.invalidateQueries({ queryKey: MONEY_KEY }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: PasswordChange) => passwordChangedSchema.parse(await apiRequest(MY_PASSWORD_PATH, { method: "POST", body })),
  });
}
