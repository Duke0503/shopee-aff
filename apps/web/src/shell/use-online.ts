/** The browser's own online state (EXPERIENCE.md Offline): the strip shows while it says offline. */
import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

export const useOnline = (): boolean => useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
