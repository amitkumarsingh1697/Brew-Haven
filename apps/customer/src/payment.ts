import type { CheckoutInfo } from "@brew-haven/contracts";

/**
 * Opens the gateway's own checkout. The result here is never trusted: the order
 * is placed only when the server verifies the gateway's signed webhook (ADR-0004).
 */
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (ev: string, fn: (r: unknown) => void) => void };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("We couldn't load the payment page. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export async function openGatewayCheckout(c: CheckoutInfo, info: { name: string; description: string }): Promise<void> {
  if (c.provider !== "razorpay") throw new Error("Unsupported payment provider");
  await loadRazorpay();
  await new Promise<void>((resolve, reject) => {
    const rz = new window.Razorpay!({
      key: c.keyId,
      order_id: c.providerOrderId,
      amount: c.amountPaise,
      currency: c.currency,
      name: info.name,
      description: info.description,
      theme: { color: "#57331F" },
      handler: () => resolve(),
      modal: { ondismiss: () => resolve() },
    });
    rz.on("payment.failed", () => reject(new Error("The payment didn't go through. No money was taken. You can try again.")));
    rz.open();
  });
}
