import { API_URL } from "./api";

/**
 * Anonymous steps of a visit for the café owner's ordering funnel: a random id per browser tab and
 * the step reached. No name, phone, device or location is sent. Respects Do Not Track.
 */
export type VisitStep = "open" | "menu" | "add" | "checkout" | "pay";
const sent = new Set<string>();

function visitId(): string {
  try {
    let v = sessionStorage.getItem("bh:visit");
    if (!v) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem("bh:visit", v);
    }
    return v;
  } catch {
    return "";
  }
}

export function track(scope: string, kind: VisitStep) {
  if (typeof navigator === "undefined" || navigator.doNotTrack === "1") return;
  const [tenant, outlet] = scope.split("/");
  const visit = visitId();
  if (!tenant || !outlet || !visit || sent.has(`${scope}|${kind}`)) return;
  sent.add(`${scope}|${kind}`);
  void fetch(`${API_URL}/v1/cafes/${tenant}/${outlet}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visit, kind }),
    keepalive: true,
  }).catch(() => undefined);
}
