import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerServiceWorker, useOnline } from "@brew-haven/pwa";
import { Redirect, Route, Switch } from "wouter";
import "@brew-haven/ui-tokens/tokens.css";
import "./styles.css";
import { Checkout } from "./screens/Checkout";
import { Menu } from "./screens/Menu";
import { ReceiptPage } from "./screens/ReceiptPage";
import { Track } from "./screens/Track";
import { Welcome } from "./screens/Welcome";

const DEFAULT_CAFE = (import.meta.env.VITE_DEFAULT_CAFE as string | undefined) ?? "400-coffee/tower-a";

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <p className="offline-banner" role="status">
      You're offline. You can look through the menu, and ordering will work again once you're back online.
    </p>
  );
}

function App() {
  return (
    <>
    <OfflineBanner />
    <Switch>
      <Route path="/order/:token/receipt">{(p) => <ReceiptPage token={p.token} />}</Route>
      <Route path="/order/:token">{(p) => <Track token={p.token} />}</Route>
      <Route path="/:tenant/:outlet/menu">{(p) => <Menu tenant={p.tenant} outlet={p.outlet} />}</Route>
      <Route path="/:tenant/:outlet/checkout">{(p) => <Checkout tenant={p.tenant} outlet={p.outlet} />}</Route>
      <Route path="/:tenant/:outlet">{(p) => <Welcome tenant={p.tenant} outlet={p.outlet} />}</Route>
      <Route>
        <Redirect to={`/${DEFAULT_CAFE}`} />
      </Route>
    </Switch>
    </>
  );
}

registerServiceWorker(import.meta.env.PROD);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
