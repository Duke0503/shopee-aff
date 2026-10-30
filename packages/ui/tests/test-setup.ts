/**
 * Test setup: jest-dom matchers, a clean DOM after each test, and a `matchMedia` the tests set
 * to a width, so a component renders its phone, tablet or desktop form like a real screen.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { setViewportWidth } from "./viewport";

afterEach(() => {
  cleanup();
  setViewportWidth(1440);
});

setViewportWidth(1440);
