import { createHash } from "node:crypto";
import { serviceWorkerSource } from "./sw.js";

/**
 * Emits /sw.js at build time with the app shell to precache. Dev builds get no service worker,
 * so hot reload is never served stale files.
 */
/**
 * @param {string} appName
 * @returns {import("vite").Plugin}
 */
export function brewHavenPwa(appName) {
  return {
    name: "brew-haven-pwa",
    apply: "build",
    generateBundle(_opts, bundle) {
      const entry = Object.values(bundle).flatMap((f) => {
        if (f.type === "chunk" && f.isEntry) return [f.fileName, ...(f.viteMetadata?.importedCss ?? [])];
        return [];
      });
      const precache = ["/index.html", "/icon.svg", "/manifest.webmanifest", ...entry.map((f) => `/${f}`)];
      const version = createHash("sha256").update(Object.keys(bundle).sort().join("\n")).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorkerSource({ version, precache, appName }) });
    },
  };
}
