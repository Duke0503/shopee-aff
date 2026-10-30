/**
 * Test setup: jest-dom matchers, a clean DOM and fetch stub after each test, and a `matchMedia`
 * set to a width, so the shell renders its phone, tablet or desktop form like a real screen.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { setViewportWidth } from "./viewport";

const browser = typeof window !== "undefined";

afterEach(() => {
  vi.unstubAllGlobals();
  if (!browser) return;
  cleanup();
  setViewportWidth(1440);
});

if (browser) setViewportWidth(1440);

/** Radix measures floating layers (tooltips) with ResizeObserver, which jsdom lacks. */
class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoResizeObserver as unknown as typeof ResizeObserver;
