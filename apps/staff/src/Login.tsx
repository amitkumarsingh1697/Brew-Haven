import { useEffect, useState } from "react";
import type { StaffSession } from "@brew-haven/contracts";
import { ApiError, api } from "./api";

export function Login({ onLogin }: { onLogin: (s: StaffSession) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.users>> | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.users().then(setData).catch((e: ApiError) => setError(e.message));
  }, []);

  const submit = async (value: string) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(user, value));
    } catch (e) {
      setError((e as ApiError).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
    if (next.length === 4) void submit(next);
  };

  return (
    <main className="login">
      <div className="login-card">
        <span className="brand">Brew Haven</span>
        <h1>{data?.tenant.name ?? "Staff sign-in"}</h1>
        {!user ? (
          <>
            <p>Who's signing in?</p>
            <div className="user-grid">
              {data?.users.map((u) => (
                <button key={u.id} className="user-btn" onClick={() => setUser(u.id)}>
                  <strong>{u.name}</strong>
                  <span>{u.role.toLowerCase()}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p>
              Enter your PIN for <strong>{data?.users.find((u) => u.id === user)?.name}</strong>
            </p>
            <div className="pin-dots" role="img" aria-label={`${pin.length} digits entered`}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={i < pin.length ? "on" : ""} />
              ))}
            </div>
            <div className="pinpad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
                k === "" ? (
                  <span key={i} />
                ) : (
                  <button key={i} onClick={() => (k === "⌫" ? setPin(pin.slice(0, -1)) : press(k))} aria-label={k === "⌫" ? "Delete" : k} disabled={busy}>
                    {k}
                  </button>
                ),
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => (setUser(null), setPin(""), setError(null))}>
              Not you?
            </button>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
