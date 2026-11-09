import { describe, expect, it } from "vitest";
import { color, contrast, textPairs } from "../src/index.js";

describe("token contrast (WCAG 2.1 AA)", () => {
  for (const [fg, bg] of textPairs) {
    it(`${fg} on ${bg} is at least 4.5:1`, () => {
      expect(contrast(color[fg], color[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
