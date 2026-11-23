import { describe, expect, it } from "vitest";
import { initErrorTracking, scrubUrl } from "../src/errorTracking.js";

describe("error tracking", () => {
  it("is off without SENTRY_DSN", async () => {
    expect(await initErrorTracking("test", "")).toBe(false);
  });
  it("removes order tracking tokens and secrets from URLs before sending", () => {
    expect(scrubUrl("https://api/v1/track/Tk_123/problem?token=abc&x=1")).toBe("https://api/v1/track/:token/problem?token=[removed]&x=1");
    expect(scrubUrl("/order/Tk_123/receipt")).toBe("/order/:token/receipt");
  });
});
