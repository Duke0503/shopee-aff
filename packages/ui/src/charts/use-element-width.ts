/**
 * The rendered width of an element, kept current with a ResizeObserver, so a chart draws at its
 * real size (text at 12 px on a phone, never a scaled-down picture). Without a ResizeObserver
 * (tests, old browsers) the fallback width is used.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export function useElementWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const next = Math.floor(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
