import { EventEmitter } from "node:events";

/** In-process fan-out for SSE. Single instance only; see ADR-0001 for scaling. */
export interface OrderChanged {
  tenantId: string;
  outletId: string;
  orderId: string;
  trackingToken: string;
  state: string;
}

export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(1000);
  }
  orderChanged(e: OrderChanged) {
    this.emitter.emit("order", e);
  }
  onOrder(fn: (e: OrderChanged) => void): () => void {
    this.emitter.on("order", fn);
    return () => this.emitter.off("order", fn);
  }
}
