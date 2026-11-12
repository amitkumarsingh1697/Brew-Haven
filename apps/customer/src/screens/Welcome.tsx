import { useEffect } from "react";
import { track } from "../track";
import { Link, useLocation } from "wouter";
import { CafeScene } from "../components/CafeScene";
import { ErrorNote, Spinner } from "../components/ui";
import { lastOrder } from "../basket";
import { useMenu } from "../hooks";
import { formatInr } from "@brew-haven/domain";

export function Welcome({ tenant, outlet }: { tenant: string; outlet: string }) {
  useEffect(() => track(`${tenant}/${outlet}`, "open"), [tenant, outlet]);
  const { menu, error, reload } = useMenu(tenant, outlet);
  const [, navigate] = useLocation();
  const previous = lastOrder.get();

  if (error && !menu) return <main className="welcome"><ErrorNote message={error} onRetry={reload} /></main>;
  if (!menu) return <main className="welcome"><Spinner label="Opening the café" /></main>;

  const b = menu.tenant.branding;
  const manager = b.managerName ?? "your barista";
  // The chalkboard in the 3D café shows the bestsellers, so it changes with the owner's menu.
  const all = menu.categories.flatMap((c) => c.items).filter((i) => i.available);
  const favourites = [...all.filter((i) => i.tags.includes("bestseller")), ...all]
    .filter((i, n, arr) => arr.indexOf(i) === n)
    .slice(0, 4)
    .map((i) => ({ name: i.name, price: formatInr(i.pricePaise).replace(".00", "") }));
  return (
    <main className="welcome">
      <header className="welcome-top">
        <span className="powered">Brew Haven</span>
        {menu.outlets.length > 1 && (
          <nav className="outlet-switch" aria-label="Choose your café">
            {menu.outlets.map((o) => (
              <Link key={o.slug} href={`/${tenant}/${o.slug}`} className={o.slug === outlet ? "chip chip-on" : "chip"} aria-current={o.slug === outlet ? "page" : undefined}>
                {o.name}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <div className="scene-wrap">
        <CafeScene cafeName={b.displayName} managerName={manager} favourites={favourites} />
        <div className="bubble" role="status">
          <strong>{manager}</strong>
          <span>{b.greeting ?? "Welcome in! What can I get you?"}</span>
        </div>
      </div>

      <section className="welcome-copy">
        <h1>{b.displayName}</h1>
        <p className="tagline">{b.tagline ?? "Where every sip feels like home"}</p>
        <p className="lede">
          Order ahead at <strong>{menu.outlet.name}</strong>, pay online, and pick up at the counter when we call your number.
        </p>
        {!menu.outlet.isOpen && <p className="closed-note">This café isn't taking orders right now.</p>}
        <button className="btn btn-primary btn-lg" onClick={() => navigate(`/${tenant}/${outlet}/menu`)} disabled={!menu.outlet.isOpen}>
          Start my order
        </button>
        {previous && (
          <Link className="btn btn-ghost-light" href={`/order/${previous}`}>
            Check my last order
          </Link>
        )}
        {menu.demoData && <p className="demo-note">Demo menu. Prices and items are illustrative.</p>}
      </section>
    </main>
  );
}
