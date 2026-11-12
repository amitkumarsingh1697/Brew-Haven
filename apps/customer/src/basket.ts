import { track } from "./track";
import { useSyncExternalStore } from "react";
import type { MenuItemDto } from "@brew-haven/contracts";

/** A basket line as the customer built it. Prices shown here are a preview; the server quote is authoritative. */
export interface BasketLine {
  key: string;
  itemId: string;
  name: string;
  quantity: number;
  modifierIds: string[];
  modifierNames: string[];
  unitPreviewPaise: number;
  note?: string;
}

type Listener = () => void;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked (in-app browsers, private mode): the basket still works in memory
  }
}

class BasketStore {
  private lines: BasketLine[] = [];
  private listeners = new Set<Listener>();
  private storageKey = "";

  use(scope: string) {
    const key = `bh:basket:${scope}`;
    if (key === this.storageKey) return;
    this.storageKey = key;
    try {
      this.lines = JSON.parse(safeGet(key) ?? "[]") as BasketLine[];
    } catch {
      this.lines = [];
    }
    this.emit();
  }
  get = () => this.lines;
  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    safeSet(this.storageKey, this.lines.length ? JSON.stringify(this.lines) : null);
    this.listeners.forEach((l) => l());
  }
  add(item: MenuItemDto, modifierIds: string[], quantity: number, note?: string) {
    track(this.storageKey.replace("bh:basket:", ""), "add");
    const options = item.modifierGroups.flatMap((g) => g.options).filter((o) => modifierIds.includes(o.id));
    const key = `${item.id}|${[...modifierIds].sort().join(",")}|${note ?? ""}`;
    const existing = this.lines.find((l) => l.key === key);
    if (existing) {
      this.lines = this.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, l.quantity + quantity) } : l));
    } else {
      this.lines = [
        ...this.lines,
        {
          key,
          itemId: item.id,
          name: item.name,
          quantity,
          modifierIds,
          modifierNames: options.map((o) => o.name),
          unitPreviewPaise: item.pricePaise + options.reduce((s, o) => s + o.pricePaise, 0),
          ...(note ? { note } : {}),
        },
      ];
    }
    this.emit();
  }
  setQuantity(key: string, quantity: number) {
    this.lines = quantity <= 0 ? this.lines.filter((l) => l.key !== key) : this.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, quantity) } : l));
    this.emit();
  }
  clear() {
    this.lines = [];
    this.emit();
  }
}

export const basket = new BasketStore();

export function useBasket() {
  const lines = useSyncExternalStore(basket.subscribe, basket.get);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const previewPaise = lines.reduce((s, l) => s + l.unitPreviewPaise * l.quantity, 0);
  return { lines, count, previewPaise };
}

export const lastOrder = {
  get: () => safeGet("bh:last-order"),
  set: (token: string) => safeSet("bh:last-order", token),
  clear: () => safeSet("bh:last-order", null),
};

export const savedDetails = {
  get: (): { name: string; phone: string } | null => {
    try {
      return JSON.parse(safeGet("bh:details") ?? "null");
    } catch {
      return null;
    }
  },
  set: (d: { name: string; phone: string }) => safeSet("bh:details", JSON.stringify(d)),
};
