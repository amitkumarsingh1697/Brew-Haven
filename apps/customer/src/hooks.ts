import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuResponse, OrderView } from "@brew-haven/contracts";
import { ApiError, api } from "./api";

const menuCache = new Map<string, MenuResponse>();

export function useMenu(tenant: string, outlet: string) {
  const key = `${tenant}/${outlet}`;
  const [menu, setMenu] = useState<MenuResponse | null>(menuCache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    api
      .menu(tenant, outlet)
      .then((m) => {
        menuCache.set(key, m);
        setMenu(m);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [tenant, outlet, key]);
  useEffect(() => {
    setMenu(menuCache.get(key) ?? null);
    reload();
  }, [key, reload]);
  return { menu, error, reload };
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
