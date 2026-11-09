import { describe, expect, it } from "vitest";
import { serviceWorkerSource } from "../src/sw.js";
import { strategyFor } from "../src/strategy.js";

const O = "https://order.400coffee.in";
const s = (url: string, mode = "cors", method = "GET") => strategyFor(url, method, mode, O);

describe("service worker routing", () => {
  it("never caches the API, payments or live updates", () => {
    expect(s(`${O}/v1/cafes/400-coffee/tower-a/menu`)).toBe("skip");
    expect(s("https://api.brewhaven.in/v1/track/abc")).toBe("skip");
    expect(s("https://checkout.razorpay.com/v1/checkout.js")).toBe("skip");
    expect(s(`${O}/assets/index-abc.js`, "cors", "POST")).toBe("skip");
  });
  it("serves pages network first and hashed assets from cache", () => {
    expect(s(`${O}/c/400-coffee/tower-a`, "navigate")).toBe("page");
    expect(s(`${O}/assets/index-abc.js`, "no-cors")).toBe("asset");
  });
  it("keeps icons, manifest and fonts", () => {
    expect(s(`${O}/icon.svg`)).toBe("static");
    expect(s(`${O}/manifest.webmanifest`)).toBe("static");
    expect(s("https://fonts.gstatic.com/s/inter/v1/x.woff2")).toBe("static");
  });
  it("generates a script that parses and names the build", () => {
    const src = serviceWorkerSource({ version: "abc123", precache: ["/index.html", "/assets/a.js"], appName: "Test" });
    expect(src).toContain('"abc123"');
    expect(() => new Function(src)).not.toThrow();
  });
});
