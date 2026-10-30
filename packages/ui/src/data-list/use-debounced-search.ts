/**
 * Search typing (LC-5): the typed text commits 300 ms after the last key, or at once on Enter,
 * so one request fires per pause, not per key. When the committed search changes from outside
 * (back button, a shared link, clearing the filters) the box follows it. Comparisons ignore outer
 * spaces, because the URL keeps the search trimmed.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 300;

export function useDebouncedSearch(committed: string, onCommit: (q: string) => void) {
  const [value, setValue] = useState(committed);
  const last = useRef(committed);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (committed.trim() === last.current.trim()) return;
    last.current = committed;
    setValue(committed);
  }, [committed]);

  useEffect(() => {
    if (value.trim() === last.current.trim()) return;
    const timer = setTimeout(() => {
      last.current = value;
      commit.current(value);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const flush = useCallback(() => {
    if (value.trim() === last.current.trim()) return;
    last.current = value;
    commit.current(value);
  }, [value]);

  return { value, setValue, flush };
}
