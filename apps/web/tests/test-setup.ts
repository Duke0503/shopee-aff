/**
 * Test setup: jest-dom matchers, a clean DOM and fetch stub after each test, and a `matchMedia`
 * set to a width, so the shell renders its phone, tablet or desktop form like a real screen.
 * Copied from the admin desk.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { setViewportWidth } from "./viewport";

const browser = typeof window !== "undefined";

// A lazy page chunk may take over a second to load while the bundle scan builds beside the tests.
configure({ asyncUtilTimeout: 4000 });

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

/** jsdom has no scrolling; the router restores scroll and a tab tap scrolls to the top. */
if (browser) window.scrollTo = () => undefined;
