/**
 * The three widths of DESIGN.md as one hook: phone 360 to 767 px, tablet 768 to 1279 px,
 * desktop 1280 px and up. Read synchronously from `matchMedia`, so the first paint already has
 * the right navigation and list layout (no flash of the desktop table on a phone).
 */
import { useMemo, useSyncExternalStore } from "react";

export type Layout = "phone" | "tablet" | "desktop";

export const TABLET_QUERY = "(min-width: 768px)";
export const DESKTOP_QUERY = "(min-width: 1280px)";

function subscribe(query: string) {
  return (onChange: () => void): (() => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
}

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const onSubscribe = useMemo(() => subscribe(query), [query]);
  return useSyncExternalStore(
    onSubscribe,
    () => matches(query),
    () => false,
  );
}

export function useLayout(): Layout {
  const tablet = useMediaQuery(TABLET_QUERY);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) return "desktop";
  return tablet ? "tablet" : "phone";
}
