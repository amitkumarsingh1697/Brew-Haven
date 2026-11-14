import { track } from "../track";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import type { MenuItemDto } from "@brew-haven/contracts";
import { basket, useBasket } from "../basket";
import { ErrorNote, ItemArt, Rs, Sheet, Spinner, Stepper, VegMark } from "../components/ui";
import { useMenu } from "../hooks";

export function Menu({ tenant, outlet }: { tenant: string; outlet: string }) {
  useEffect(() => track(`${tenant}/${outlet}`, "menu"), [tenant, outlet]);
  const { menu, error, reload, savedAt } = useMenu(tenant, outlet);
  const { count, previewPaise } = useBasket();
  const [active, setActive] = useState<string | null>(null);
  const [vegOnly, setVegOnly] = useState(false);
  const [open, setOpen] = useState<{ item: MenuItemDto; category: string } | null>(null);
  const [, navigate] = useLocation();
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => basket.use(`${tenant}/${outlet}`), [tenant, outlet]);

  const categories = useMemo(
    () => (menu?.categories ?? []).map((c) => ({ ...c, items: vegOnly ? c.items.filter((i) => i.isVeg) : c.items })).filter((c) => c.items.length),
    [menu, vegOnly],
  );

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.getAttribute("data-cat"));
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    sectionRefs.current.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [categories]);

  if (error && !menu) return <main className="page"><ErrorNote message={error} onRetry={reload} /></main>;
  if (!menu) return <main className="page"><Spinner label="Fetching the menu" /></main>;

  const quickAdd = (item: MenuItemDto, category: string) => {
    if (item.modifierGroups.length === 0) basket.add(item, [], 1);
    else setOpen({ item, category });
  };

  return (
    <main className="page menu-page">
      <header className="menu-header">
        <div className="menu-title">
          <Link href={`/${tenant}/${outlet}`} className="back" aria-label="Back to the café">
            ‹
          </Link>
          <div>
            <h1>{menu.tenant.branding.displayName}</h1>
            <p>{menu.outlet.name} · Takeaway</p>
          </div>
          <label className="veg-toggle">
            <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />
            <VegMark veg /> Veg only
          </label>
        </div>
        <nav className="cat-chips" aria-label="Menu sections">
          {categories.map((c) => (
            <button
              key={c.id}
              className={active === c.id ? "chip chip-on" : "chip"}
              onClick={() => sectionRefs.current.get(c.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              {c.name}
            </button>
          ))}
        </nav>
      </header>
      {savedAt && (
        <p className="saved-note" role="status">
          Showing the menu saved on {new Date(savedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Prices are checked again when you order.
        </p>
      )}

      {categories.map((c) => (
        <section
          key={c.id}
          data-cat={c.id}
          ref={(el) => {
            if (el) sectionRefs.current.set(c.id, el);
            else sectionRefs.current.delete(c.id);
          }}
          className="menu-section"
          aria-labelledby={`cat-${c.id}`}
        >
          <h2 id={`cat-${c.id}`}>{c.name}</h2>
          <ul className="item-list">
            {c.items.map((i) => (
              <li key={i.id} className={i.available ? "item-card" : "item-card sold-out"}>
                <button className="item-main" onClick={() => i.available && setOpen({ item: i, category: c.name })} disabled={!i.available}>
                  <ItemArt category={c.name} name={i.name} />
                  <div className="item-text">
                    <div className="item-name">
                      <VegMark veg={i.isVeg} />
                      <span>{i.name}</span>
                    </div>
                    {i.tags.includes("bestseller") && <span className="tag">Bestseller</span>}
                    {i.tags.includes("new") && <span className="tag tag-new">New</span>}
                    <p>{i.description}</p>
                    <Rs paise={i.pricePaise} />
                  </div>
                </button>
                {i.available ? (
                  <button className="add-btn" onClick={() => quickAdd(i, c.name)} aria-label={`Add ${i.name}`}>
                    Add
                  </button>
                ) : (
                  <span className="sold-out-label">Sold out</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!menu.tenant.pricesIncludeTax && <p className="menu-tax-note">Prices are before GST. {menu.tenant.taxRateBps / 100}% GST is added on your bill at checkout.</p>}

      {count > 0 && (
        <div className="basket-bar">
          <button className="btn btn-primary btn-block" onClick={() => navigate(`/${tenant}/${outlet}/checkout`)}>
            <span>
              {count} item{count > 1 ? "s" : ""} · <Rs paise={previewPaise} />
              {!menu.tenant.pricesIncludeTax && " + GST"}
            </span>
            <span>View basket ›</span>
          </button>
        </div>
      )}

      {open && <ItemSheet item={open.item} category={open.category} onClose={() => setOpen(null)} />}
    </main>
  );
}

export function ItemSheet({
  item,
  category,
  onClose,
  onConfirm,
  confirmLabel,
}: {
  item: MenuItemDto;
  category: string;
  onClose: () => void;
  onConfirm?: (modifierIds: string[], quantity: number, note?: string) => void;
  confirmLabel?: string;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(item.modifierGroups.map((g) => [g.id, g.minSelect > 0 ? [g.options[0]!.id] : []])),
  );
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const all = Object.values(chosen).flat();
  const unit = item.pricePaise + item.modifierGroups.flatMap((g) => g.options).filter((o) => all.includes(o.id)).reduce((s, o) => s + o.pricePaise, 0);

  const toggle = (groupId: string, optionId: string, max: number) =>
    setChosen((c) => {
      const cur = c[groupId] ?? [];
      if (max === 1) return { ...c, [groupId]: [optionId] };
      if (cur.includes(optionId)) return { ...c, [groupId]: cur.filter((x) => x !== optionId) };
      if (cur.length >= max) return c;
      return { ...c, [groupId]: [...cur, optionId] };
    });

  const confirm = () => {
    const n = note.trim() || undefined;
    if (onConfirm) onConfirm(all, qty, n);
    else basket.add(item, all, qty, n);
    onClose();
  };

  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="sheet-head">
        <ItemArt category={category} name={item.name} />
        <div>
          <h2>
            <VegMark veg={item.isVeg} /> {item.name}
          </h2>
          <p>{item.description}</p>
        </div>
      </div>
      {item.modifierGroups.map((g) => (
        <fieldset key={g.id} className="mod-group">
          <legend>
            {g.name}
            <span>{g.minSelect > 0 ? "Required" : g.maxSelect > 1 ? `Up to ${g.maxSelect}` : "Optional"}</span>
          </legend>
          {g.options.map((o) => {
            const on = chosen[g.id]?.includes(o.id) ?? false;
            return (
              <label key={o.id} className={on ? "mod-option on" : "mod-option"}>
                <input type={g.maxSelect === 1 ? "radio" : "checkbox"} name={g.id} checked={on} onChange={() => toggle(g.id, o.id, g.maxSelect)} />
                <span>{o.name}</span>
                {o.pricePaise > 0 && (
                  <span className="mod-price">
                    + <Rs paise={o.pricePaise} />
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      ))}
      <label className="note-field">
        <span>Anything we should know? (optional)</span>
        <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="e.g. extra hot, less ice" />
      </label>
      <div className="sheet-foot">
        <Stepper value={qty} onChange={setQty} label="Quantity" />
        <button className="btn btn-primary" onClick={confirm}>
          {confirmLabel ?? "Add"} · <Rs paise={unit * qty} />
        </button>
      </div>
    </Sheet>
  );
}
