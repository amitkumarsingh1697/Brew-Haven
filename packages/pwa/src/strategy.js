/**
 * How the service worker treats one request. Kept as a plain function with no imports so it can
 * be unit-tested here and copied verbatim into the generated sw.js (see sw.ts).
 *
 * - "page": an HTML navigation. Network first so a deploy shows up at once; the saved app shell
 *   is the offline fallback.
 * - "asset": a hashed build file under /assets/. These never change, so cache first.
 * - "static": icons, manifest and Google Fonts. Serve the saved copy and refresh it behind.
 * - "skip": everything else, above all the API, payments and live order updates. Orders and
 *   prices must always come from the server, never from a cache.
 */
/**
 * @param {string} url
 * @param {string} method
 * @param {string} mode
 * @param {string} origin
 * @returns {"page" | "asset" | "static" | "skip"}
 */
export function strategyFor(url, method, mode, origin) {
  if (method !== "GET") return "skip";
  const u = new URL(url);
  if (u.origin === "https://fonts.googleapis.com" || u.origin === "https://fonts.gstatic.com") return "static";
  if (u.origin !== origin) return "skip";
  if (u.pathname.startsWith("/v1/") || u.pathname === "/health") return "skip";
  if (mode === "navigate") return "page";
  if (u.pathname.startsWith("/assets/")) return "asset";
  if (/\.(svg|png|webmanifest|ico|woff2?)$/.test(u.pathname)) return "static";
  return "skip";
}
