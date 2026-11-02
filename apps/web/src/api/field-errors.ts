/** A refused form's field errors, worded from the server's message keys (AD-20 `fields`). */
import { foldDiacritics } from "@cashback/core";

import { ApiError } from "./api.queries";
import { errorText } from "../labels";

export function serverFieldErrors<F extends string>(error: unknown, fields: readonly F[]): Partial<Record<F, string>> {
  if (!(error instanceof ApiError)) return {};
  const out: Partial<Record<F, string>> = {};
  for (const field of fields) {
    const key = error.fields[field];
    if (key !== undefined) out[field] = errorText(key, error.code);
  }
  return out;
}

/** The form-level line of a refusal the server did not tie to a field; null when it did. */
export function formErrorOf(error: unknown, fields: readonly string[]): string | null {
  if (!(error instanceof ApiError)) return error === null || error === undefined ? null : errorText("error.network", "network");
  if (fields.some((f) => error.fields[f] !== undefined)) return null;
  return errorText(error.messageKey, error.code);
}

/** Text folded for a search: lower case, accents and the d-stroke removed (packages/core's one fold). */
export const foldText = (text: string): string => foldDiacritics(text).toLowerCase();
