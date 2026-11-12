import { useEffect, useSyncExternalStore } from "react";
import type { OrderView } from "@brew-haven/contracts";
import { ApiError, api, getTenant } from "./api";

/**
 * Counter orders the till couldn't send because the connection was down. They are kept on this
 * device and sent, oldest first, as soon as it's back. Each carries its own reference, so a send
 * that times out and is tried again never makes a second order.
 */
export type WalkInBody = Parameters<typeof api.walkIn>[0];
export interface QueuedOrder {
  clientRef: string;
  ticket: string;
  outletName: string;
  body: WalkInBody;
  takenAt: string;
  totalPaise: number;
  summary: string;
  status: "waiting" | "failed";
  error?: string;
}
export interface SentNote {
  clientRef: string;
  ticket: string;
  pickupCode: string;
  orderId: string;
  /** Set when Brew Haven's price differs from what the till showed while offline. */
  recordedPaise?: number;
  takenPaise?: number;
}

const key = () => `bh:counter-queue:${getTenant()}`;
const noteKey = () => `bh:counter-sent:${getTenant()}`;
const read = <T,>(k: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the queue still lives in memory for this session */
  }
};

let queue: QueuedOrder[] = read(key(), []);
let sent: SentNote[] = read(noteKey(), []);
let snapshot = { queue, sent };
const listeners = new Set<() => void>();
const emit = () => {
  write(key(), queue);
  write(noteKey(), sent);
  snapshot = { queue, sent };
  listeners.forEach((l) => l());
};

export const newClientRef = () =>
  typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16));

/** A network failure (as opposed to the server saying no). */
export const isOffline = (e: unknown) => (e instanceof ApiError && e.status === 0) || (typeof navigator !== "undefined" && navigator.onLine === false);

export function enqueue(o: Omit<QueuedOrder, "ticket" | "status" | "takenAt">): QueuedOrder {
  const n = read<number>(`${key()}:n`, 0) + 1;
  write(`${key()}:n`, n);
  const q: QueuedOrder = { ...o, ticket: `OFF-${n}`, status: "waiting", takenAt: new Date().toISOString() };
  queue = [...queue, q];
  emit();
  return q;
}

export function discard(clientRef: string) {
  queue = queue.filter((q) => q.clientRef !== clientRef);
  emit();
}
export function retry(clientRef: string) {
  queue = queue.map((q) => (q.clientRef === clientRef ? { ...q, status: "waiting" as const, error: undefined } : q)) as QueuedOrder[];
  emit();
  void flush();
}
export function dismissNote(clientRef: string) {
  sent = sent.filter((s) => s.clientRef !== clientRef);
  emit();
}

let flushing = false;
let onSent: (o: OrderView) => void = () => undefined;

/** Sends waiting orders oldest first. Stops at the first network failure and tries again later. */
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (const q of queue.filter((x) => x.status === "waiting")) {
      try {
        const o = await api.walkIn({ ...q.body, clientRef: q.clientRef, takenOfflineAt: q.takenAt });
        queue = queue.filter((x) => x.clientRef !== q.clientRef);
        sent = [{ clientRef: q.clientRef, ticket: q.ticket, pickupCode: o.pickupCode ?? "", orderId: o.id, ...(o.paidPaise !== q.totalPaise ? { recordedPaise: o.paidPaise, takenPaise: q.totalPaise } : {}) }, ...sent].slice(0, 20);
        emit();
        onSent(o);
      } catch (e) {
        if (isOffline(e)) break;
        queue = queue.map((x) => (x.clientRef === q.clientRef ? { ...x, status: "failed" as const, error: (e as Error).message } : x));
        emit();
      }
    }
  } finally {
    flushing = false;
  }
}

/** Keeps sending in the background while the till is open, on whichever tab it is on. */
export function useCounterQueueSync(onOrder: (o: OrderView) => void) {
  useEffect(() => {
    onSent = onOrder;
    const tick = () => void flush();
    tick();
    window.addEventListener("online", tick);
    const t = window.setInterval(tick, 15_000);
    return () => {
      window.removeEventListener("online", tick);
      window.clearInterval(t);
    };
  }, [onOrder]);
}

export function useCounterQueue() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot,
  );
}
