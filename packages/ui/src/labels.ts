/**
 * Text for the shared components (NFR-7, D57). Every visible word comes from
 * packages/labels/vi; code only names keys, so a typo in a key fails the typecheck.
 */
import status from "@cashback/labels/vi/status.json";
import ui from "@cashback/labels/vi/ui.json";

export type UiKey = keyof typeof ui;
type Params = Readonly<Record<string, string | number>>;

/** Fills `{name}` placeholders; a placeholder without a value is left visible, never blanked. */
export function fillLabel(template: string, params?: Params): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

export function uiText(key: UiKey, params?: Params): string {
  return fillLabel(ui[key], params);
}

const statusLabels: Readonly<Record<string, string>> = status;

/** A status label by the registry's label key; a missing key shows the key itself, never blank. */
export function statusLabel(labelKey: string): string {
  return statusLabels[labelKey] ?? labelKey;
}
