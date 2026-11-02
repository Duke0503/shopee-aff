/**
 * A fake viewport for jsdom: `matchMedia` answers `(min-width: N px)` queries from the width set
 * here, the way the browser does at that width.
 */
let width = 1440;
const listeners = new Set<() => void>();

function evaluate(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (min !== null && width < Number(min[1])) return false;
  if (max !== null && width > Number(max[1])) return false;
  return min !== null || max !== null;
}

export function setViewportWidth(next: number): void {
  width = next;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: next });
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return evaluate(query);
      },
      onchange: null,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
  for (const listener of listeners) listener();
}
