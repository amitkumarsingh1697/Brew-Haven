import { useEffect, useState } from "react";
import type { StaffSession } from "@brew-haven/contracts";
import { ApiError, api, setTenant } from "./api";

/** Self-serve sign-up: a new café business creates its account, first café and owner sign-in. */
export function Signup({ onDone, onCancel }: { onDone: (s: StaffSession) => void; onCancel: () => void }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [f, setF] = useState({ businessName: "", cafeName: "", address: "", ownerName: "", email: "", phone: "", pin: "", pin2: "", sampleMenu: true, acceptTerms: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.signupOpen().then((r) => setOpen(r.open), () => setOpen(false));
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(f.pin)) return setError("Choose a 4-digit PIN.");
    if (f.pin !== f.pin2) return setError("The two PINs don't match.");
    if (!f.acceptTerms) return setError("Please accept the terms to continue.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.signup({
        businessName: f.businessName,
        cafeName: f.cafeName || f.businessName,
        address: f.address || undefined,
        ownerName: f.ownerName,
        email: f.email,
        phone: f.phone,
        pin: f.pin,
        sampleMenu: f.sampleMenu,
        acceptTerms: true,
      });
      setTenant(r.tenantSlug);
      try {
        sessionStorage.setItem("bh:welcome", "1");
      } catch {
        /* ignore */
      }
      onDone(r.session);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-card signup-card">
        <span className="brand">Brew Haven</span>
        <h1>Start your café</h1>
        {open === false ? (
          <>
            <p>Sign-up isn't open right now. Get in touch and we'll set up your account.</p>
            <button className="btn btn-ghost" onClick={onCancel}>
              Back to sign-in
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="signup-form">
            <p className="muted small">Takes a minute. You can change everything later in Setup.</p>
            <fieldset>
              <legend>Your business</legend>
              <label>
                Business name
                <input value={f.businessName} onChange={set("businessName")} required maxLength={60} autoComplete="organization" placeholder="e.g. Blue Door Café" />
              </label>
              <label>
                First café or branch
                <input value={f.cafeName} onChange={set("cafeName")} maxLength={60} placeholder="e.g. Koramangala" />
              </label>
              <label>
                <span>
                  Address <span className="muted">(optional)</span>
                </span>
                <input value={f.address} onChange={set("address")} maxLength={400} autoComplete="street-address" />
              </label>
            </fieldset>
            <fieldset>
              <legend>You, the owner</legend>
              <label>
                Your name
                <input value={f.ownerName} onChange={set("ownerName")} required maxLength={60} autoComplete="name" />
              </label>
              <label>
                Email
                <input type="email" value={f.email} onChange={set("email")} required maxLength={200} autoComplete="email" />
              </label>
              <label>
                Mobile number
                <input type="tel" value={f.phone} onChange={set("phone")} required inputMode="tel" autoComplete="tel" placeholder="98450 12345" />
              </label>
              <div className="pin-pair">
                <label>
                  Sign-in PIN
                  <input type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={f.pin} onChange={set("pin")} required autoComplete="new-password" />
                </label>
                <label>
                  PIN again
                  <input type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} value={f.pin2} onChange={set("pin2")} required autoComplete="new-password" />
                </label>
              </div>
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={f.sampleMenu} onChange={set("sampleMenu")} /> Start with a sample menu I can edit
            </label>
            <label className="check">
              <input type="checkbox" checked={f.acceptTerms} onChange={set("acceptTerms")} /> I accept the terms of service and privacy policy
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary" disabled={busy || open === null}>
              {busy ? "Creating your café…" : "Create my café"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              I already have an account
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
