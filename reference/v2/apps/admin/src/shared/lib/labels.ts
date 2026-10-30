import { useSyncExternalStore } from "react";

import { createApiClient, type ApiLabels } from "@mmo/contracts";

import bundled from "../../../../../resources/dashboard.vi.json";

/**
 * Every word on screen comes from `resources/dashboard.vi.json` — the same file
 * the server re-reads on each request (`GET /api/labels`), so the owner can
 * change wording without a rebuild.
 *
 * The file is imported here as well, so the very first paint already has words;
 * the live copy replaces it as soon as it answers. `label` falls back to the key
 * itself when a key is missing, so a typo is visible instead of silently blank.
 */
export type Labels = ApiLabels;

/** Keys are checked at compile time against the label file. */
export type LabelKey = keyof typeof bundled;

const BUNDLED: Labels = bundled;
const api = createApiClient();

let current: Labels = BUNDLED;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): void {
  if (loading !== null) return;
  loading = api
    .labels()
    .then((live) => {
      current = { ...BUNDLED, ...live };
      for (const listener of listeners) listener();
    })
    .catch(() => {
      // Keep the bundled copy: the console stays readable while the server is
      // unreachable, and the screen's own error shows what went wrong.
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = (): Labels => current;

/** The labels. Every screen shares one request, however many of them ask. */
export function useLabels(): Labels {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** One label, with `{name}` placeholders filled in. */
export function label(
  labels: Labels,
  key: LabelKey,
  values: Record<string, string | number> = {},
): string {
  const text = labels[key] ?? BUNDLED[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}
