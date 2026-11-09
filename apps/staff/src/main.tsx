import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MenuResponse, StaffRole, StaffSession } from "@brew-haven/contracts";
import "@brew-haven/ui-tokens/tokens.css";
import "./styles.css";
import { api, setSessionToken } from "./api";
import { useLiveOrders } from "./live";
import { Login } from "./Login";
import { Board, Kitchen, NewOrder, Stock, Today } from "./screens";

type Tab = "orders" | "kitchen" | "new" | "stock" | "today";
const TABS: Array<{ id: Tab; label: string; roles: StaffRole[] }> = [
  { id: "orders", label: "Orders", roles: ["ADMIN", "CASHIER", "KITCHEN"] },
  { id: "kitchen", label: "Kitchen display", roles: ["ADMIN", "KITCHEN", "CASHIER"] },
  { id: "new", label: "New counter order", roles: ["ADMIN", "CASHIER"] },
  { id: "stock", label: "Stock", roles: ["ADMIN", "CASHIER", "KITCHEN"] },
  { id: "today", label: "Today", roles: ["ADMIN", "CASHIER"] },
];

function loadSession(): StaffSession | null {
  try {
    return JSON.parse(sessionStorage.getItem("bh:staff") ?? "null");
  } catch {
    return null;
  }
}

function App() {
  const [session, setSession] = useState<StaffSession | null>(() => {
    const s = loadSession();
    if (s) setSessionToken(s.token);
    return s;
  });
  const logout = () => {
    try {
      sessionStorage.removeItem("bh:staff");
    } catch {
      /* ignore */
    }
    setSessionToken(null);
    setSession(null);
  };
  useEffect(() => {
    setSessionToken(session?.token ?? null, logout);
  }, [session]);

  if (!session) {
    return (
      <Login
        onLogin={(s) => {
          try {
            sessionStorage.setItem("bh:staff", JSON.stringify(s));
          } catch {
            /* ignore */
          }
          setSessionToken(s.token, logout);
          setSession(s);
        }}
      />
    );
  }
  return <Workspace session={session} onLogout={logout} />;
}

function Workspace({ session, onLogout }: { session: StaffSession; onLogout: () => void }) {
  const role = session.user.role;
  const [outletId, setOutletId] = useState(session.outlets[0]?.id ?? "");
  const outlet = session.outlets.find((o) => o.id === outletId)!;
  const tabs = TABS.filter((t) => t.roles.includes(role));
  const [tab, setTab] = useState<Tab>(role === "KITCHEN" ? "kitchen" : "orders");
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const live = useLiveOrders(outletId, { sound: role !== "ADMIN" });

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    setMenu(null);
    api.menu(outlet.slug).then(setMenu).catch(() => undefined);
  }, [outlet.slug, tab]);

  const waiting = live.orders.filter((o) => o.state === "PLACED").length;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Brew Haven</span>
        <span className="cafe">{session.tenant.name}</span>
        {session.outlets.length > 1 ? (
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Café">
            {session.outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="outlet">{outlet.name}</span>
        )}
        <span className={live.connected ? "live on" : "live"} title={live.connected ? "Live updates on" : "Reconnecting… the board refreshes every 20 seconds"}>
          {live.connected ? "Live" : "Reconnecting"}
        </span>
        <span className="user">
          {session.user.name}
          <button className="link-btn" onClick={onLogout}>
            Sign out
          </button>
        </span>
      </header>
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "tab on" : "tab"} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "orders" && waiting > 0 && <span className="badge">{waiting}</span>}
          </button>
        ))}
      </nav>
      {live.error && <p className="error banner">{live.error}</p>}
      <main className="content">
        {tab === "orders" && <Board live={live} role={role} now={now} />}
        {tab === "kitchen" && <Kitchen live={live} role={role} now={now} menu={menu} />}
        {tab === "new" && <NewOrder outletId={outletId} menu={menu} onCreated={live.upsert} />}
        {tab === "stock" && <Stock key={outletId} outletId={outletId} role={role} />}
        {tab === "today" && <Today key={outletId} outletId={outletId} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
