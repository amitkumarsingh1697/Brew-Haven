import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MenuResponse, OutletWithStations, StaffRole, StaffSession } from "@brew-haven/contracts";
import "@brew-haven/ui-tokens/tokens.css";
import "./styles.css";
import { api, setSessionToken } from "./api";
import { useLiveOrders } from "./live";
import { Admin } from "./Admin";
import { Login } from "./Login";
import { Board, Kitchen, NewOrder, Stock, Today } from "./screens";

type Tab = "orders" | "kitchen" | "new" | "stock" | "today" | "setup";
const TABS: Array<{ id: Tab; label: string; roles: StaffRole[] }> = [
  { id: "orders", label: "Orders", roles: ["ADMIN", "CASHIER", "KITCHEN"] },
  { id: "kitchen", label: "Kitchen display", roles: ["ADMIN", "KITCHEN", "CASHIER"] },
  { id: "new", label: "New counter order", roles: ["ADMIN", "CASHIER"] },
  { id: "stock", label: "Stock", roles: ["ADMIN", "CASHIER", "KITCHEN"] },
  { id: "today", label: "Today", roles: ["ADMIN", "CASHIER"] },
  { id: "setup", label: "Setup", roles: ["ADMIN"] },
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
  const [tab, setTab] = useState<Tab>(role === "KITCHEN" ? "kitchen" : "orders");
  // Cafés come from the server so ones the owner adds appear without signing in again.
  const [outlets, setOutlets] = useState<OutletWithStations[] | null>(null);
  const refreshOutlets = () => api.outlets().then(setOutlets).catch(() => undefined);
  // Refresh on every tab change too, so kitchens added in Setup show up on the kitchen display.
  useEffect(() => void refreshOutlets(), [tab]);
  const list: Array<{ id: string; slug: string; name: string; stations?: OutletWithStations["stations"] }> = outlets ?? session.outlets;
  const [outletId, setOutletId] = useState(session.outlets[0]?.id ?? "");
  const outlet = list.find((o) => o.id === outletId) ?? list[0]!;
  const tabs = TABS.filter((t) => t.roles.includes(role));
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const live = useLiveOrders(outlet.id, { sound: role !== "ADMIN" });

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
        {list.length > 1 ? (
          <select value={outlet.id} onChange={(e) => setOutletId(e.target.value)} aria-label="Café">
            {list.map((o) => (
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
        {tab === "kitchen" && <Kitchen live={live} role={role} now={now} menu={menu} stations={outlet.stations ?? []} />}
        {tab === "new" && <NewOrder outletId={outlet.id} menu={menu} onCreated={live.upsert} />}
        {tab === "stock" && <Stock key={outlet.id} outletId={outlet.id} role={role} />}
        {tab === "today" && <Today key={outlet.id} outletId={outlet.id} />}
        {tab === "setup" && <Admin onOutletsChanged={refreshOutlets} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
