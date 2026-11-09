import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuResponse, OrderView } from "@brew-haven/contracts";
import { saved, useOnReconnect } from "@brew-haven/pwa";
import { ApiError, api } from "./api";

const menuCache = new Map<string, MenuResponse>();
type SavedMenu = { menu: MenuResponse; at: string };
const storeKey = (key: string) => `bh.menu.${key}`;

/**
 * The café menu. The last good copy is kept on the device, so the menu still shows with no
 * connection; `savedAt` is set while that copy is what's on screen. Prices are always
 * re-checked by the server when an order is placed, so an old copy can't charge the wrong amount.
 */
export function useMenu(tenant: string, outlet: string) {
  const key = `${tenant}/${outlet}`;
  const initial = () => menuCache.get(key) ?? saved.get<SavedMenu>(storeKey(key))?.menu ?? null;
  const [menu, setMenu] = useState<MenuResponse | null>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    api
      .menu(tenant, outlet)
      .then((m) => {
        menuCache.set(key, m);
        saved.set(storeKey(key), { menu: m, at: new Date().toISOString() } satisfies SavedMenu);
        setMenu(m);
        setSavedAt(null);
      })
      .catch((e: ApiError) => {
        const copy = menuCache.has(key) ? null : saved.get<SavedMenu>(storeKey(key));
        if (copy) {
          setMenu(copy.menu);
          setSavedAt(copy.at);
        } else if (!menuCache.has(key)) setError(e.message);
      });
  }, [tenant, outlet, key]);
  useEffect(() => {
    setMenu(initial());
    reload();
  }, [key, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useOnReconnect(reload);
  return { menu, error, reload, savedAt };
}

/** Live order status: SSE first, with polling as the fallback (REST stays authoritative). */
export function useOrder(token: string) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const pollRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => {
    api
      .track(token)
      .then((o) => {
        setOrder(o);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [token]);

  useEffect(() => {
    refresh();
    let es: EventSource | null = null;
    try {
      es = new EventSource(api.streamUrl(token));
      es.addEventListener("order", (ev) => {
        setOrder(JSON.parse((ev as MessageEvent).data) as OrderView);
        setLive(true);
      });
      es.onerror = () => setLive(false);
    } catch {
      es = null;
    }
    pollRef.current = window.setInterval(() => {
      if (!es || es.readyState !== EventSource.OPEN) refresh();
    }, 8000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      es?.close();
      window.clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, refresh]);
  useOnReconnect(refresh);

  return { order, setOrder, error, live, refresh };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
