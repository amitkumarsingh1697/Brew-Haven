import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderView } from "@brew-haven/contracts";
import { api } from "./api";

const LIVE = new Set(["PLACED", "PREPARING", "ACTION_REQUIRED", "READY"]);

/** A short two-note chime for a new order (no audio file needed). */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
  } catch {
    // audio blocked until the first tap; the board still updates
  }
}

/**
 * Live order queue for one outlet: SSE pushes, with a periodic full refetch
 * as the safety net (REST is authoritative, ADR-005 / TC-015).
 */
export function useLiveOrders(outletId: string, opts: { sound?: boolean } = {}) {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Set<string>());
  const soundRef = useRef(opts.sound);
  soundRef.current = opts.sound;

  const upsert = useCallback((o: OrderView) => {
    if (o.state === "PLACED" && !known.current.has(o.id) && soundRef.current) chime();
    known.current.add(o.id);
    setOrders((cur) => {
      const rest = cur.filter((x) => x.id !== o.id);
      return LIVE.has(o.state) ? [...rest, o] : rest;
    });
  }, []);

  const refresh = useCallback(() => {
    api
      .orders(outletId)
      .then((list) => {
        list.forEach((o) => known.current.add(o.id));
        setOrders(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [outletId]);

  useEffect(() => {
    known.current = new Set();
    refresh();
    let es: EventSource | null = null;
    let retry: number | undefined;
    let attempt = 0;
    const connect = () => {
      es = new EventSource(api.streamUrl(outletId));
      es.addEventListener("hello", () => {
        attempt = 0;
        setConnected(true);
        refresh(); // catch anything missed while disconnected
      });
      es.addEventListener("order", (ev) => upsert(JSON.parse((ev as MessageEvent).data) as OrderView));
      es.onerror = () => {
        setConnected(false);
        es?.close();
        // Backoff with jitter so a Wi-Fi blip doesn't make every tablet reconnect at once.
        const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
        retry = window.setTimeout(connect, delay);
      };
    };
    connect();
    const poll = window.setInterval(refresh, 20_000);
    return () => {
      es?.close();
      window.clearTimeout(retry);
      window.clearInterval(poll);
    };
  }, [outletId, refresh, upsert]);

  return { orders, connected, error, refresh, upsert };
}

export function minutesSince(iso: string | null, now: number) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
}
