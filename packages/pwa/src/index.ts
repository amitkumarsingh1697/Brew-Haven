import { useEffect, useState } from "react";

/** Registers /sw.js in production builds. Safe to call where service workers aren't supported. */
export function registerServiceWorker(enabled: boolean) {
  if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app works without it; it just won't open offline.
    });
  });
}

/** True while the browser reports a connection. Re-renders on change. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Runs `fn` each time the connection comes back, so screens can refresh what they show. */
export function useOnReconnect(fn: () => void) {
  useEffect(() => {
    window.addEventListener("online", fn);
    return () => window.removeEventListener("online", fn);
  }, [fn]);
}

/** localStorage that never throws (private mode, blocked storage, quota). */
export const saved = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not saving is fine; it only means no offline copy.
    }
  },
};
