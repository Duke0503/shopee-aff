/**
 * Whether the on-screen keyboard is likely open (EXPERIENCE.md bottom tab bar: hidden while the
 * keyboard is open). A focused text field on a touch screen opens it; the visual viewport
 * shrinking well below the layout viewport says so too where focus alone does not (Android
 * Chrome, the Zalo in-app browser).
 */
import { useEffect, useState } from "react";

const NOT_TYPED = new Set(["button", "checkbox", "radio", "submit", "reset", "file", "range", "color", "image"]);

export function typesText(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NOT_TYPED.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

const viewportShrunk = (): boolean => {
  const visual = window.visualViewport;
  return visual !== null && visual !== undefined && visual.height < window.innerHeight * 0.75;
};

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = (): void => setOpen(typesText(document.activeElement) || viewportShrunk());
    // focusout fires before the next element is focused; read the new focus after it settles.
    const later = (): void => void setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return open;
}
