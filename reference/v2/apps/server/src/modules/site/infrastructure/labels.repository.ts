import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Web labels, read from `resources/dashboard.vi.json` on every request so the
 * site changes without a restart and without a deploy. Keys starting with `_`
 * are notes to the editor, not text for the page.
 */
export const DEFAULT_LABELS_PATH = fileURLToPath(
  new URL("../../../../../../resources/dashboard.vi.json", import.meta.url),
);

export function labelsPath(): string {
  return process.env.LABELS_PATH ?? DEFAULT_LABELS_PATH;
}

export function loadLabels(path: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("_")) labels[key] = value;
  }
  return labels;
}
