/**
 * The customer website's text (NFR-7, D57): keys into packages/labels/vi/web.json and errors.json.
 * The website never writes a visible word in code.
 */
import errors from "@cashback/labels/vi/errors.json";
import web from "@cashback/labels/vi/web.json";
import { fillLabel } from "@cashback/ui";

export type WebKey = keyof typeof web;
type Params = Readonly<Record<string, string | number>>;

export function webText(key: WebKey, params?: Params): string {
  return fillLabel(web[key], params);
}

const errorLabels: Readonly<Record<string, string>> = errors;

/** The text for a server error envelope's `messageKey`; an unknown key falls back to its code's text. */
export function errorText(messageKey: string, code: string, params?: Params): string {
  const template = errorLabels[messageKey] ?? errorLabels[`error.${code}`] ?? errorLabels["error.internal"] ?? messageKey;
  return fillLabel(template, params);
}
