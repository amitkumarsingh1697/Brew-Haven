import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Redirect, Route, Switch } from "wouter";
import "@brew-haven/ui-tokens/tokens.css";
import "./styles.css";
import { Checkout } from "./screens/Checkout";
import { Menu } from "./screens/Menu";
import { Track } from "./screens/Track";
import { Welcome } from "./screens/Welcome";

const DEFAULT_CAFE = (import.meta.env.VITE_DEFAULT_CAFE as string | undefined) ?? "400-coffee/tower-a";

function App() {
  return (
    <Switch>
      <Route path="/order/:token">{(p) => <Track token={p.token} />}</Route>
      <Route path="/:tenant/:outlet/menu">{(p) => <Menu tenant={p.tenant} outlet={p.outlet} />}</Route>
      <Route path="/:tenant/:outlet/checkout">{(p) => <Checkout tenant={p.tenant} outlet={p.outlet} />}</Route>
      <Route path="/:tenant/:outlet">{(p) => <Welcome tenant={p.tenant} outlet={p.outlet} />}</Route>
      <Route>
        <Redirect to={`/${DEFAULT_CAFE}`} />
      </Route>
    </Switch>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
