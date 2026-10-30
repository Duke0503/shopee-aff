/**
 * The admin desk's text (NFR-7, D57): keys into packages/labels/vi/admin.json and errors.json.
 * The desk never writes a visible word in code.
 */
import admin from "@cashback/labels/vi/admin.json";
import errors from "@cashback/labels/vi/errors.json";
import { fillLabel } from "@cashback/ui";

export type AdminKey = keyof typeof admin;
type Params = Readonly<Record<string, string | number>>;

export function adminText(key: AdminKey, params?: Params): string {
  return fillLabel(admin[key], params);
}

const errorLabels: Readonly<Record<string, string>> = errors;

/** The text for a server error envelope's `messageKey`; an unknown key falls back to its code's text. */
export function errorText(messageKey: string, code: string, params?: Params): string {
  const template = errorLabels[messageKey] ?? errorLabels[`error.${code}`] ?? errorLabels["error.internal"] ?? messageKey;
  return fillLabel(template, params);
}
