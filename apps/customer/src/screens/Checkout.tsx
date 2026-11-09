import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import type { QuoteResponse } from "@brew-haven/contracts";
import { IndianMobile } from "@brew-haven/contracts";
import { ApiError, api } from "../api";
import { basket, lastOrder, savedDetails, useBasket } from "../basket";
import { ErrorNote, Rs, Stepper } from "../components/ui";
import { useOnline } from "@brew-haven/pwa";
import { useMenu } from "../hooks";

export function Checkout({ tenant, outlet }: { tenant: string; outlet: string }) {
  const { menu } = useMenu(tenant, outlet);
  const { lines } = useBasket();
  const [, navigate] = useLocation();
  const saved = savedDetails.get();
  const [name, setName] = useState(saved?.name ?? "");
  const [phone, setPhone] = useState(saved?.phone ?? "");
  const [offers, setOffers] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const online = useOnline();
  // One key per checkout attempt, so a double tap or a retry never creates two orders.
  const idemKey = useRef(crypto.randomUUID());

  useEffect(() => basket.use(`${tenant}/${outlet}`), [tenant, outlet]);

  const payload = useMemo(() => lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, modifierIds: l.modifierIds, ...(l.note ? { note: l.note } : {}) })), [lines]);

  // A new basket is a new checkout attempt. Coming back online is not, so a payment that went
  // through just before the connection dropped is never charged twice.
  useEffect(() => {
    idemKey.current = crypto.randomUUID();
  }, [payload]);

  useEffect(() => {
    if (!payload.length || !online) return;
    let cancelled = false;
    setQuoteError(null);
    api
      .quote(tenant, outlet, payload)
      .then((q) => !cancelled && setQuote(q))
      .catch((e: ApiError) => !cancelled && setQuoteError(e.message));
    return () => {
      cancelled = true;
    };
  }, [payload, tenant, outlet, online]);

  const phoneCheck = IndianMobile.safeParse(phone);
  const nameOk = name.trim().length > 0;

  if (!lines.length) {
    return (
      <main className="page checkout-page">
        <div className="empty">
          <h1>Your basket is empty</h1>
          <p>Pick something warm, or something cold.</p>
          <Link className="btn btn-primary" href={`/${tenant}/${outlet}/menu`}>
            Back to the menu
          </Link>
        </div>
      </main>
    );
  }

  const submit = async () => {
    setTouched(true);
    if (!nameOk || !phoneCheck.success || !quote) return;
    setBusy(true);
    setSubmitError(null);
    try {
      savedDetails.set({ name: name.trim(), phone });
      const res = await api.createOrder(
        tenant,
        outlet,
        { lines: payload, customer: { name: name.trim(), phone }, consent: { orderUpdates: true, offers } },
        idemKey.current,
      );
      lastOrder.set(res.trackingToken);
      try {
        sessionStorage.setItem(`bh:checkout:${res.trackingToken}`, JSON.stringify(res.checkout));
      } catch {
        // storage blocked: the tracking page asks the server for a fresh payment attempt
      }
      basket.clear();
      navigate(`/order/${res.trackingToken}?pay=${res.checkout.paymentId}`);
    } catch (e) {
      setSubmitError((e as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <main className="page checkout-page">
      <header className="simple-header">
        <Link href={`/${tenant}/${outlet}/menu`} className="back" aria-label="Back to the menu">
          ‹
        </Link>
        <h1>Your order</h1>
        <span className="sub">{menu?.outlet.name ?? ""} · Takeaway</span>
      </header>

      <section className="card">
        <ul className="basket-lines">
          {lines.map((l) => (
            <li key={l.key}>
              <div>
                <strong>{l.name}</strong>
                {l.modifierNames.length > 0 && <span className="mods">{l.modifierNames.join(" · ")}</span>}
                {l.note && <span className="mods">“{l.note}”</span>}
              </div>
              <Stepper value={l.quantity} min={0} onChange={(n) => basket.setQuantity(l.key, n)} label={`Quantity of ${l.name}`} />
              <Rs paise={l.unitPreviewPaise * l.quantity} />
            </li>
          ))}
        </ul>
        <Link className="link" href={`/${tenant}/${outlet}/menu`}>
          + Add more
        </Link>
      </section>

      <section className="card totals" aria-live="polite">
        {quoteError ? (
          <ErrorNote message={quoteError} />
        ) : quote ? (
          <>
            <div className="row total">
              <span>To pay</span>
              <Rs paise={quote.totalPaise} />
            </div>
            <div className="row small">
              <span>Includes GST ({(quote.taxRateBps / 100).toFixed(0)}%)</span>
              <Rs paise={quote.taxPaise} />
            </div>
          </>
        ) : (
          <div className="row">
            <span>{online ? "Checking prices…" : "We'll check prices when you're back online."}</span>
          </div>
        )}
      </section>

      <section className="card form">
        <h2>Who's collecting?</h2>
        <label>
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={60} aria-invalid={touched && !nameOk} />
          {touched && !nameOk && <em className="field-error">Please tell us your name</em>}
        </label>
        <label>
          <span>Mobile number</span>
          <div className="phone">
            <span>+91</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" aria-invalid={touched && !phoneCheck.success} />
          </div>
          {touched && !phoneCheck.success && <em className="field-error">Enter a 10-digit Indian mobile number</em>}
        </label>
        <p className="consent-note">We'll use this number only to send updates about this order.</p>
        <label className="check">
          <input type="checkbox" checked={offers} onChange={(e) => setOffers(e.target.checked)} />
          <span>Also send me offers from {menu?.tenant.branding.displayName ?? "the café"} (optional, you can stop any time)</span>
        </label>
      </section>

      {submitError && <ErrorNote message={submitError} />}

      <div className="pay-bar">
        <button className="btn btn-primary btn-block btn-lg" onClick={submit} disabled={busy || !quote || !online}>
          {!online ? "You're offline" : busy ? "Placing your order…" : quote ? <>Pay <Rs paise={quote.totalPaise} /></> : "Pay"}
        </button>
        <p className="fine">Your order goes to the kitchen as soon as the payment is confirmed.</p>
      </div>
    </main>
  );
}
