import { useDialog } from "@brew-haven/ui-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { AdminSetup, OutletWithStations } from "@brew-haven/contracts";
import { formatInr } from "@brew-haven/domain";
import { InventoryAdmin } from "./Inventory";
import { ApiError, CUSTOMER_URL, api, getTenant, type ActivityEntry, type AdminItem, type ItemInput, type GstSummary, type KitchenSpeed, type SpeedSpread, type SalesReport } from "./api";

/** Owner self-service (D-17): cafés, kitchens, menu, staff, settings and QR codes. */
type Section = "reports" | "checks" | "inventory" | "cafes" | "menu" | "staff" | "settings" | "messages" | "activity";

export function Admin({ onOutletsChanged }: { onOutletsChanged: () => void }) {
  const [setup, setSetup] = useState<AdminSetup | null>(null);
  const [section, setSection] = useState<Section>("reports");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(() => {
    try {
      return sessionStorage.getItem("bh:welcome") === "1";
    } catch {
      return false;
    }
  });
  const dismissWelcome = () => {
    try {
      sessionStorage.removeItem("bh:welcome");
    } catch {
      /* ignore */
    }
    setWelcome(false);
  };

  const reload = () =>
    api.admin
      .setup()
      .then((s) => (setSetup(s), setError(null)))
      .catch((e: ApiError) => setError(e.message));
  useEffect(() => void reload(), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  /** Runs a change, shows the server's message on failure, and refreshes. */
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await fn();
      await reload();
      if (done) setToast(done);
      return true;
    } catch (e) {
      setError((e as ApiError).message);
      return false;
    }
  };

  if (!setup) return <p className="muted">{error ?? "Loading setup…"}</p>;
  return (
    <div className="admin">
      <nav className="subtabs" role="tablist" aria-label="Setup">
        {(
          [
            ["reports", "Reports"],
            ["checks", "Payment checks"],
            ["inventory", "Inventory"],
            ["cafes", `Cafés & kitchens (${setup.outlets.length})`],
            ["menu", "Menu"],
            ["staff", "Staff"],
            ["settings", "Café settings"],
            ["messages", "Customer messages"],
            ["activity", "Activity"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} className={section === id ? "chip chip-on" : "chip"} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      {welcome && setup.outlets[0] && (
        <section className="panel welcome" aria-labelledby="welcome-h">
          <h2 id="welcome-h">Your café is ready</h2>
          <p>
            Customers can already order at{" "}
            <a href={`${CUSTOMER_URL}/${getTenant()}/${setup.outlets[0].slug}`} target="_blank" rel="noreferrer">
              your menu page
            </a>
            . Three things to do next:
          </p>
          <ol>
            <li>
              <button className="link-btn" onClick={() => setSection("menu")}>
                Check your menu and prices
              </button>
            </li>
            <li>
              <button className="link-btn" onClick={() => setSection("staff")}>
                Add your team
              </button>{" "}
              so each person signs in with their own PIN
            </li>
            <li>
              <button className="link-btn" onClick={() => setSection("cafes")}>
                Print the QR code
              </button>{" "}
              for your counter and tables
            </li>
          </ol>
          <p className="muted small">
            Your staff sign in on any device at this address with the business link <strong>{getTenant()}</strong>.
          </p>
          <button className="btn btn-ghost" onClick={dismissWelcome}>
            Got it
          </button>
        </section>
      )}
      {error && (
        <p className="error banner-inline" role="alert">
          {error}
        </p>
      )}
      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
      {section === "reports" && <Reports setup={setup} />}
      {section === "checks" && <PaymentChecks setup={setup} />}
      {section === "inventory" && <InventoryAdmin setup={setup} act={act} />}
      {section === "cafes" && <Cafes setup={setup} act={act} onOutletsChanged={onOutletsChanged} />}
      {section === "menu" && <MenuAdmin setup={setup} act={act} />}
      {section === "staff" && <StaffAdmin setup={setup} act={act} />}
      {section === "settings" && (
        <>
          <PlanCard plan={setup.tenant.plan} />
          <Settings setup={setup} act={act} />
        </>
      )}
      {section === "messages" && <Messages />}
      {section === "activity" && <Activity setup={setup} />}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;

// ---------- Cafés, kitchens and QR codes ----------

function Cafes({ setup, act, onOutletsChanged }: { setup: AdminSetup; act: Act; onOutletsChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [qr, setQr] = useState<OutletWithStations | null>(null);
  const usedLetters = new Set(setup.outlets.map((o) => o.pickupPrefix));
  const nextLetter = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !usedLetters.has(l)) ?? "";

  return (
    <div className="admin-grid">
      {setup.outlets.map((o) => (
        <CafeCard key={o.id} outlet={o} act={act} onQr={() => setQr(o)} onOutletsChanged={onOutletsChanged} />
      ))}
      {adding ? (
        <NewCafe
          defaultLetter={nextLetter}
          onCancel={() => setAdding(false)}
          onCreate={async (b) => {
            const ok = await act(() => api.admin.createOutlet(b), `${b.name} added. It can take orders now.`);
            if (ok) {
              setAdding(false);
              onOutletsChanged();
            }
          }}
        />
      ) : (
        <button className="add-card" onClick={() => setAdding(true)} disabled={atLimit(setup.tenant.plan.maxCafes, setup.tenant.plan.cafes)}>
          <span>+</span> Add a new café
          {atLimit(setup.tenant.plan.maxCafes, setup.tenant.plan.cafes) && <small className="muted">Your {setup.tenant.plan.name} plan includes {setup.tenant.plan.maxCafes === 1 ? "1 café" : `${setup.tenant.plan.maxCafes} cafés`}</small>}
        </button>
      )}
      {qr && <QrPoster outlet={qr} cafeName={setup.tenant.branding.displayName} onClose={() => setQr(null)} />}
    </div>
  );
}

function NewCafe({ defaultLetter, onCreate, onCancel }: { defaultLetter: string; onCreate: (b: { name: string; pickupPrefix: string; address?: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [letter, setLetter] = useState(defaultLetter);
  const [address, setAddress] = useState("");
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ name: name.trim(), pickupPrefix: letter.trim().toUpperCase(), ...(address.trim() ? { address: address.trim() } : {}) });
      }}
    >
      <h2>New café</h2>
      <label>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tower C" maxLength={60} />
      </label>
      <label>
        Pickup letter <small>Order numbers start with this, e.g. {letter || "C"}-001</small>
        <input required value={letter} onChange={(e) => setLetter(e.target.value.toUpperCase())} maxLength={3} pattern="[A-Za-z]{1,3}" />
      </label>
      <label>
        Address or location (optional)
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Ground floor, Tower C" maxLength={200} />
      </label>
      <p className="muted small">It starts with the same kitchens as your first café. You can change them after.</p>
      <div className="row-btns">
        <button className="btn btn-primary" type="submit">
          Add café
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CafeCard({ outlet, act, onQr, onOutletsChanged }: { outlet: OutletWithStations; act: Act; onQr: () => void; onOutletsChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(outlet.name);
  const [letter, setLetter] = useState(outlet.pickupPrefix);
  const [address, setAddress] = useState(outlet.address ?? "");
  const [newStation, setNewStation] = useState("");
  const link = `${CUSTOMER_URL}/${getTenant()}/${outlet.slug}`;

  return (
    <section className="panel cafe-card">
      <header>
        {editing ? (
          <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Café name" />
        ) : (
          <h2>{outlet.name}</h2>
        )}
        <button
          className={outlet.isOpen ? "toggle on" : "toggle"}
          role="switch"
          aria-checked={outlet.isOpen}
          onClick={() => act(() => api.admin.updateOutlet(outlet.id, { isOpen: !outlet.isOpen }), outlet.isOpen ? `${outlet.name} closed for orders` : `${outlet.name} open for orders`)}
        >
          {outlet.isOpen ? "Taking orders" : "Closed"}
        </button>
      </header>
      {editing ? (
        <div className="form-grid">
          <label>
            Pickup letter
            <input value={letter} onChange={(e) => setLetter(e.target.value.toUpperCase())} maxLength={3} />
          </label>
          <label>
            Address
            <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
          </label>
          <div className="row-btns">
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (await act(() => api.admin.updateOutlet(outlet.id, { name: name.trim(), pickupPrefix: letter.trim(), address: address.trim() }), "Saved")) {
                  setEditing(false);
                  onOutletsChanged();
                }
              }}
            >
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl>
          <dt>Order numbers</dt>
          <dd>{outlet.pickupPrefix}-001, {outlet.pickupPrefix}-002…</dd>
          {outlet.address && (
            <>
              <dt>Location</dt>
              <dd>{outlet.address}</dd>
            </>
          )}
          <dt>Ordering link</dt>
          <dd className="link-cell">
            <a href={link} target="_blank" rel="noreferrer">
              {link.replace(/^https?:\/\//, "")}
            </a>
          </dd>
        </dl>
      )}
      <h3>Kitchens</h3>
      <ul className="stations">
        {outlet.stations.map((s) => (
          <li key={s.id}>
            <span>{s.name}</span>
            <button
              className="link-btn"
              onClick={() => {
                const n = window.prompt("Rename kitchen", s.name)?.trim();
                if (n) void act(() => api.admin.renameStation(s.id, n), "Kitchen renamed");
              }}
            >
              Rename
            </button>
            <button
              className="link-btn danger"
              onClick={() => window.confirm(`Remove ${s.name} from ${outlet.name}?`) && act(() => api.admin.removeStation(s.id), "Kitchen removed")}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (newStation.trim() && (await act(() => api.admin.addStation(outlet.id, newStation.trim()), "Kitchen added"))) setNewStation("");
        }}
      >
        <input value={newStation} onChange={(e) => setNewStation(e.target.value)} placeholder="Add a kitchen, e.g. Grill" maxLength={60} />
        <button className="btn btn-ghost" type="submit">
          Add
        </button>
      </form>
      <footer className="row-btns">
        <button className="btn btn-primary" onClick={onQr}>
          QR code poster
        </button>
        {!editing && (
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>
            Edit details
          </button>
        )}
      </footer>
    </section>
  );
}

function QrPoster({ outlet, cafeName, onClose }: { outlet: OutletWithStations; cafeName: string; onClose: () => void }) {
  const link = `${CUSTOMER_URL}/${getTenant()}/${outlet.slug}`;
  const [svg, setSvg] = useState<string>("");
  const [png, setPng] = useState<string>("");
  useEffect(() => {
    void QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#120D0A", light: "#FBF6EC" } }).then(setSvg);
    void QRCode.toDataURL(link, { margin: 2, width: 1200, errorCorrectionLevel: "M", color: { dark: "#120D0A", light: "#FFFFFF" } }).then(setPng);
  }, [link]);
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="modal-backdrop qr-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal qr-modal" role="dialog" aria-modal="true" aria-label={`QR code for ${outlet.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="poster" id="qr-poster">
          <span className="poster-brand">Brew Haven</span>
          <h2>{cafeName}</h2>
          <p className="poster-outlet">{outlet.name}</p>
          <div className="poster-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="poster-cta">Scan to order ahead</p>
          <p className="poster-sub">Pay on your phone · collect at the counter</p>
          <p className="poster-link">{link.replace(/^https?:\/\//, "")}</p>
        </div>
        <div className="row-btns no-print">
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print poster
          </button>
          {png && (
            <a className="btn btn-ghost" href={png} download={`qr-${outlet.slug}.png`}>
              Download QR image
            </a>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Menu ----------

function MenuAdmin({ setup, act }: { setup: AdminSetup; act: Act }) {
  const [catId, setCatId] = useState<string | null>(setup.categories[0]?.id ?? null);
  const [editing, setEditing] = useState<AdminItem | "new" | null>(null);
  const [newCat, setNewCat] = useState("");
  const cat = setup.categories.find((c) => c.id === catId) ?? setup.categories[0];
  const items = setup.items.filter((i) => i.categoryId === cat?.id);
  const stationOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of setup.outlets) for (const s of o.stations) if (!m.has(s.key)) m.set(s.key, s.name);
    return [...m.entries()].map(([key, name]) => ({ key, name }));
  }, [setup.outlets]);
  const stationName = (k: string) => stationOptions.find((s) => s.key === k)?.name ?? k;

  return (
    <div className="menu-admin">
      <aside className="panel cats">
        <h2>Menu sections</h2>
        <ul>
          {setup.categories.map((c) => (
            <li key={c.id}>
              <button className={c.id === cat?.id ? "cat on" : "cat"} onClick={() => setCatId(c.id)}>
                {c.name}
                {!c.active && <small> (hidden)</small>}
                <span className="muted small">{setup.items.filter((i) => i.categoryId === c.id && i.active).length}</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newCat.trim() && (await act(() => api.admin.createCategory(newCat.trim()), "Section added"))) setNewCat("");
          }}
        >
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New section, e.g. Smoothies" maxLength={60} />
          <button className="btn btn-ghost" type="submit">
            Add
          </button>
        </form>
      </aside>
      <section className="panel items-panel">
        {cat ? (
          <>
            <header className="items-head">
              <h2>{cat.name}</h2>
              <button
                className="link-btn"
                onClick={() => {
                  const n = window.prompt("Rename section", cat.name)?.trim();
                  if (n) void act(() => api.admin.updateCategory(cat.id, { name: n }), "Section renamed");
                }}
              >
                Rename
              </button>
              <button className="link-btn" onClick={() => act(() => api.admin.updateCategory(cat.id, { name: cat.name, active: !cat.active }), cat.active ? "Section hidden from customers" : "Section visible")}>
                {cat.active ? "Hide section" : "Show section"}
              </button>
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                + Add item
              </button>
            </header>
            <div className="table-wrap">
              <table className="items-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Price</th>
                    <th>Kitchen</th>
                    {setup.outlets.map((o) => (
                      <th key={o.id} title={`Sold at ${o.name}`}>
                        {o.name}
                      </th>
                    ))}
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className={i.active ? "" : "off"}>
                      <td>
                        <span className={`dot ${i.isVeg ? "veg" : "nonveg"}`} role="img" aria-label={i.isVeg ? "Veg" : "Non-veg"} /> {i.name}
                        {!i.active && <small> · not on sale</small>}
                        {i.modifierGroups.length > 0 && <small className="muted"> · {i.modifierGroups.map((g) => g.name).join(", ")}</small>}
                      </td>
                      <td className="num">{formatInr(i.pricePaise).replace(".00", "")}</td>
                      <td>{stationName(i.stationKey)}</td>
                      {setup.outlets.map((o) => {
                        const sold = !i.unlistedAt.includes(o.id);
                        return (
                          <td key={o.id}>
                            <input
                              type="checkbox"
                              checked={sold}
                              aria-label={`Sell ${i.name} at ${o.name}`}
                              onChange={() => act(() => api.admin.listing(o.id, i.id, !sold), sold ? `${i.name} removed from ${o.name}` : `${i.name} now sold at ${o.name}`)}
                            />
                          </td>
                        );
                      })}
                      <td>
                        <button className="link-btn" onClick={() => setEditing(i)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={4 + setup.outlets.length} className="muted">
                        No items in this section yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted">Add a menu section to start.</p>
        )}
      </section>
      {editing && cat && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          categories={setup.categories}
          defaultCategory={cat.id}
          stations={stationOptions}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const ok = await act(
              () => (editing === "new" ? api.admin.createItem(body) : api.admin.updateItem(editing.id, body)),
              editing === "new" ? `${body.name} added to the menu` : `${body.name} saved`,
            );
            if (ok) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

type GroupDraft = { name: string; required: boolean; maxSelect: number; options: Array<{ name: string; rupees: string }> };

function ItemEditor({
  item,
  categories,
  defaultCategory,
  stations,
  onClose,
  onSave,
}: {
  item: AdminItem | null;
  categories: AdminSetup["categories"];
  defaultCategory: string;
  stations: Array<{ key: string; name: string }>;
  onClose: () => void;
  onSave: (b: ItemInput) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [rupees, setRupees] = useState(item ? String(item.pricePaise / 100) : "");
  const [isVeg, setIsVeg] = useState(item?.isVeg ?? true);
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? defaultCategory);
  const [stationKey, setStationKey] = useState(item?.stationKey ?? stations[0]?.key ?? "kitchen");
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [active, setActive] = useState(item?.active ?? true);
  const [groups, setGroups] = useState<GroupDraft[]>(
    item?.modifierGroups.map((g) => ({ name: g.name, required: g.minSelect > 0, maxSelect: g.maxSelect, options: g.options.map((o) => ({ name: o.name, rupees: String(o.pricePaise / 100) })) })) ?? [],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const toPaise = (r: string) => Math.round(Number(r || "0") * 100);

  const submit = () => {
    const price = toPaise(rupees);
    if (!name.trim()) return setProblem("Give the item a name");
    if (!Number.isFinite(price) || price < 100) return setProblem("Enter a price of at least ₹1");
    for (const g of groups) {
      if (!g.name.trim()) return setProblem("Every option group needs a name, e.g. Size");
      if (g.options.some((o) => !o.name.trim())) return setProblem(`Every choice in "${g.name}" needs a name`);
      if (g.options.length === 0) return setProblem(`Add at least one choice to "${g.name}"`);
    }
    setProblem(null);
    onSave({
      name: name.trim(),
      description: description.trim(),
      pricePaise: price,
      isVeg,
      categoryId,
      stationKey,
      tags,
      active,
      modifierGroups: groups.map((g) => {
        const max = Math.min(Math.max(1, g.maxSelect), g.options.length);
        return { name: g.name.trim(), minSelect: g.required ? 1 : 0, maxSelect: g.required ? Math.max(1, max) : max, options: g.options.map((o) => ({ name: o.name.trim(), pricePaise: toPaise(o.rupees) })) };
      }),
    });
  };

  const setGroup = (i: number, patch: Partial<GroupDraft>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  const dialogRef = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal item-modal" role="dialog" aria-modal="true" aria-label={item ? `Edit ${item.name}` : "New item"} onClick={(e) => e.stopPropagation()}>
        <h2>{item ? `Edit ${item.name}` : "New menu item"}</h2>
        <div className="form-grid two">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
          </label>
          <label>
            Price (₹, including GST)
            <input value={rupees} onChange={(e) => setRupees(e.target.value)} inputMode="decimal" placeholder="180" />
          </label>
          <label className="span2">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} placeholder="One line that makes it sound delicious" />
          </label>
          <label>
            Section
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Made in kitchen
            <select value={stationKey} onChange={(e) => setStationKey(e.target.value)}>
              {stations.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="span2 inline-checks">
            <legend>Type and labels</legend>
            <label>
              <input type="radio" checked={isVeg} onChange={() => setIsVeg(true)} /> Veg
            </label>
            <label>
              <input type="radio" checked={!isVeg} onChange={() => setIsVeg(false)} /> Non-veg
            </label>
            {(["bestseller", "new", "seasonal", "spicy"] as const).map((t) => (
              <label key={t}>
                <input type="checkbox" checked={tags.includes(t)} onChange={(e) => setTags(e.target.checked ? [...tags, t] : tags.filter((x) => x !== t))} /> {t}
              </label>
            ))}
            <label>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> On sale
            </label>
          </fieldset>
        </div>

        <h3>Options customers can choose</h3>
        {groups.length === 0 && <p className="muted small">No options. Add one for things like size, milk or sugar.</p>}
        {groups.map((g, gi) => (
          <div key={gi} className="group-edit">
            <div className="group-head">
              <input value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} placeholder="Option group, e.g. Size" aria-label="Option group name" />
              <label>
                <input type="checkbox" checked={g.required} onChange={(e) => setGroup(gi, { required: e.target.checked })} /> Must choose
              </label>
              <label>
                Up to
                <input type="number" min={1} max={10} value={g.maxSelect} onChange={(e) => setGroup(gi, { maxSelect: Number(e.target.value) })} className="tiny" />
              </label>
              <button className="link-btn danger" onClick={() => setGroups(groups.filter((_, j) => j !== gi))}>
                Remove group
              </button>
            </div>
            {g.options.map((o, oi) => (
              <div key={oi} className="option-edit">
                <input value={o.name} onChange={(e) => setGroup(gi, { options: g.options.map((x, k) => (k === oi ? { ...x, name: e.target.value } : x)) })} placeholder="Choice, e.g. Large" aria-label="Choice name" />
                <span>+ ₹</span>
                <input value={o.rupees} onChange={(e) => setGroup(gi, { options: g.options.map((x, k) => (k === oi ? { ...x, rupees: e.target.value } : x)) })} inputMode="decimal" className="tiny" aria-label="Extra price" placeholder="0" />
                <button className="link-btn danger" onClick={() => setGroup(gi, { options: g.options.filter((_, k) => k !== oi) })} aria-label="Remove choice">
                  ×
                </button>
              </div>
            ))}
            <button className="link-btn" onClick={() => setGroup(gi, { options: [...g.options, { name: "", rupees: "0" }] })}>
              + Add choice
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => setGroups([...groups, { name: "", required: true, maxSelect: 1, options: [{ name: "", rupees: "0" }] }])}>
          + Add option group
        </button>
        {problem && <p className="error">{problem}</p>}
        <div className="row-btns">
          <button className="btn btn-primary" onClick={submit}>
            {item ? "Save changes" : "Add to menu"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="muted small">Price changes apply to new orders only. Orders already placed keep the price they were paid at.</p>
      </div>
    </div>
  );
}

// ---------- Staff ----------

const ROLE_LABEL = { ADMIN: "Owner / admin", CASHIER: "Cashier", KITCHEN: "Kitchen" } as const;

function StaffAdmin({ setup, act }: { setup: AdminSetup; act: Act }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"CASHIER" | "KITCHEN" | "ADMIN">("CASHIER");
  const [pin, setPin] = useState("");
  const [outletIds, setOutletIds] = useState<string[]>(setup.outlets[0] ? [setup.outlets[0].id] : []);
  const outletName = (id: string) => setup.outlets.find((o) => o.id === id)?.name ?? "?";

  return (
    <div className="staff-admin">
      <section className="panel">
        <h2>Team</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Cafés</th>
                <th>Status</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {setup.staff.map((u) => (
                <tr key={u.id} className={u.active ? "" : "off"}>
                  <td>{u.name}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.role === "ADMIN" ? "All cafés" : u.outletIds.map(outletName).join(", ")}</td>
                  <td>{u.active ? "Active" : "Removed"}</td>
                  <td className="row-btns">
                    <button
                      className="link-btn"
                      onClick={() => {
                        const p = window.prompt(`New 4-digit PIN for ${u.name}`)?.trim();
                        if (p) void act(() => api.admin.updateStaff(u.id, { pin: p }), "PIN changed");
                      }}
                    >
                      Reset PIN
                    </button>
                    <button className="link-btn" onClick={() => act(() => api.admin.updateStaff(u.id, { active: !u.active }), u.active ? `${u.name} can no longer sign in` : `${u.name} can sign in again`)}>
                      {u.active ? "Remove" : "Restore"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => api.admin.createStaff({ name: name.trim(), role, pin, outletIds: role === "ADMIN" ? setup.outlets.map((o) => o.id) : outletIds }), `${name.trim()} added`)) {
            setName("");
            setPin("");
          }
        }}
      >
        <h2>Add a team member</h2>
        <label>
          Name shown at sign-in
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi · Tower C" maxLength={60} />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="CASHIER">Cashier: takes counter orders, hands over, rejects with refund</option>
            <option value="KITCHEN">Kitchen: sees tickets, marks ready, marks items sold out</option>
            <option value="ADMIN">Owner / admin: everything, including this setup</option>
          </select>
        </label>
        {role !== "ADMIN" && (
          <fieldset className="inline-checks">
            <legend>Works at</legend>
            {setup.outlets.map((o) => (
              <label key={o.id}>
                <input type="checkbox" checked={outletIds.includes(o.id)} onChange={(e) => setOutletIds(e.target.checked ? [...outletIds, o.id] : outletIds.filter((x) => x !== o.id))} /> {o.name}
              </label>
            ))}
          </fieldset>
        )}
        <label>
          4-digit PIN
          <input required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" pattern="\d{4}" placeholder="••••" />
        </label>
        <button className="btn btn-primary" type="submit">
          Add team member
        </button>
      </form>
    </div>
  );
}

// ---------- Settings ----------

const atLimit = (max: number | null, used: number) => max !== null && used >= max;

function PlanCard({ plan }: { plan: AdminSetup["tenant"]["plan"] }) {
  const line = (label: string, used: number, max: number | null) => (
    <li>
      {label}: <strong>{used}</strong> {max === null ? "(no limit)" : `of ${max}`}
    </li>
  );
  return (
    <section className="panel plan-card" aria-labelledby="plan-h">
      <h2 id="plan-h">Your plan: {plan.name}</h2>
      <p className="plan-price">
        <strong>{formatInr(plan.monthlyPaise)}</strong> a month, or {formatInr(plan.yearlyPaise)} a year (two months free). Prices are before GST.
      </p>
      <BillingLine billing={plan.billing} />
      <ul>
        {line("Cafés", plan.cafes, plan.maxCafes)}
        {line("Active team members, you included", plan.staff, plan.maxStaff)}
      </ul>
      {(plan.maxCafes !== null || plan.maxStaff !== null) && <p className="muted small">Need more? Contact us to move to a bigger plan.</p>}
    </section>
  );
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

function BillingLine({ billing }: { billing: AdminSetup["tenant"]["plan"]["billing"] }) {
  const days = billing.daysLeft ?? 0;
  const left = days <= 1 ? "Last day" : `${days} days left`;
  switch (billing.state) {
    case "trial":
      return (
        <p className="billing-line trial">
          <span className="pill">Free trial</span> {left}. Your trial ends on {longDate(billing.until!)}. We'll be in touch before then about paying for your plan.
        </p>
      );
    case "paid":
      return (
        <p className="billing-line">
          <span className="pill">Paid</span> Paid until {longDate(billing.until!)}.
        </p>
      );
    case "trial_over":
      return (
        <p className="billing-line due" role="status">
          <span className="pill warn">Payment due</span> Your free trial ended on {longDate(billing.until!)}. Please contact us to pay for your plan and keep taking orders.
        </p>
      );
    case "overdue":
      return (
        <p className="billing-line due" role="status">
          <span className="pill warn">Payment due</span> Your plan was paid until {longDate(billing.until!)}. Please contact us to renew and keep taking orders.
        </p>
      );
    default:
      return null;
  }
}

function Settings({ setup, act }: { setup: AdminSetup; act: Act }) {
  const b = setup.tenant.branding;
  const [displayName, setDisplayName] = useState(b.displayName);
  const [tagline, setTagline] = useState(b.tagline ?? "");
  const [greeting, setGreeting] = useState(b.greeting ?? "");
  const [managerName, setManagerName] = useState(b.managerName ?? "");
  const [gst, setGst] = useState(String(setup.tenant.taxRateBps / 100));
  const bill = setup.tenant.billing;
  const [legalName, setLegalName] = useState(bill.legalName ?? "");
  const [gstin, setGstin] = useState(bill.gstin ?? "");
  const [fssai, setFssai] = useState(bill.fssaiLicence ?? "");
  const [footer, setFooter] = useState(bill.footer ?? "");
  return (
    <form
      className="panel settings"
      onSubmit={(e) => {
        e.preventDefault();
        void act(
          () =>
            api.admin.settings({
              displayName: displayName.trim(),
              tagline: tagline.trim() || undefined,
              greeting: greeting.trim() || undefined,
              managerName: managerName.trim() || undefined,
              taxRateBps: Math.round(Number(gst) * 100),
              billing: { legalName: legalName.trim(), gstin: gstin.trim().toUpperCase(), fssaiLicence: fssai.trim(), footer: footer.trim() },
            }),
          "Settings saved. Customers see them straight away.",
        );
      }}
    >
      <h2>What customers see</h2>
      <label>
        Café name
        <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
      </label>
      <label>
        Tagline
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={80} />
      </label>
      <label>
        Virtual manager's name
        <input value={managerName} onChange={(e) => setManagerName(e.target.value)} maxLength={30} />
      </label>
      <label>
        Welcome line
        <input value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={140} />
      </label>
      <h2>Tax</h2>
      <label>
        GST rate included in menu prices (%)
        <input value={gst} onChange={(e) => setGst(e.target.value)} inputMode="decimal" />
        <small className="muted">Confirm the right rate with your accountant. Restaurants without input tax credit usually use 5%.</small>
      </label>
      <h2>On the receipt</h2>
      <p className="muted small">With a GSTIN saved, receipts become tax invoices showing CGST and SGST. Leave it empty if the café isn't registered for GST.</p>
      <label>
        Registered business name
        <input value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={100} placeholder="e.g. 400 Coffee Private Limited" />
      </label>
      <label>
        GSTIN
        <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="15 characters, e.g. 29ABCDE1234F1Z5" autoCapitalize="characters" spellCheck={false} />
      </label>
      <label>
        FSSAI licence number
        <input value={fssai} onChange={(e) => setFssai(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={14} placeholder="14 digits" />
        <small className="muted">Food businesses must print this on bills.</small>
      </label>
      <label>
        Thank-you line
        <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={140} placeholder="e.g. Thank you! See you tomorrow." />
      </label>
      <button className="btn btn-primary" type="submit">
        Save settings
      </button>
    </form>
  );
}

// ---------- Activity: who changed what ----------

function Activity({ setup }: { setup: AdminSetup }) {
  const [outletId, setOutletId] = useState("");
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: number) => {
    setLoading(true);
    try {
      const r = await api.admin.activity({ outletId: outletId || undefined, before });
      setRows((prev) => (before ? [...prev, ...r.entries] : r.entries));
      setNext(r.nextBefore);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), [outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="panel activity">
      <header className="items-head">
        <h2>Activity</h2>
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Filter by café">
          <option value="">All cafés</option>
          {setup.outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </header>
      <p className="muted small">Every change by your team and you: order actions, stock, menu, cafés, staff and sign-ins.</p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="items-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Café</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{when(r.at)}</td>
                <td>{r.actor}</td>
                <td>{r.summary}</td>
                <td>{r.outlet ?? "—"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {next && (
        <button className="btn btn-ghost" disabled={loading} onClick={() => load(next)}>
          {loading ? "Loading…" : "Show older"}
        </button>
      )}
    </section>
  );
}

// ---------- Customer messages (WhatsApp) ----------

const STATUS_LABEL: Record<string, string> = { SENT: "Sent", DELIVERED: "Delivered", READ: "Read", LOGGED: "Preview only", FAILED: "Failed, retrying", REJECTED: "Not delivered", QUEUED: "Sending" };

function Messages() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.notifications>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.admin.notifications().then(setData, (e: ApiError) => setError(e.message));
  }, []);
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="panel activity">
      <header className="items-head">
        <h2>Customer messages</h2>
      </header>
      {data && !data.delivers && (
        <p className="banner-inline note">
          WhatsApp isn't connected yet, so these messages are previews of what customers will receive. Nothing has been sent.
        </p>
      )}
      <p className="muted small">Customers get a message when their order is confirmed, when it's ready, if an item runs out, and if it's cancelled.</p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="items-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Order</th>
              <th>To</th>
              <th>Message</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.messages.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">{when(m.at)}</td>
                <td className="nowrap">
                  {m.orderCode ?? "—"} <small className="muted">{m.outlet}</small>
                </td>
                <td className="nowrap">{m.to}</td>
                <td>{m.body}</td>
                <td className="nowrap" title={m.error ?? undefined}>
                  <span className={`pill pill-${m.status.toLowerCase()}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
                </td>
              </tr>
            ))}
            {data && data.messages.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No messages yet. They appear here as orders come in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Reports ----------

const METHOD_LABEL: Record<string, string> = { ONLINE: "Paid online", CASH: "Cash", UPI_COUNTER: "UPI at counter", CARD_COUNTER: "Card at counter" };

/** Business dates are Asia/Kolkata, same as the API. */
const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
type ExportKind = Parameters<typeof api.admin.exportCsv>[0];
const EXPORTS: Array<[ExportKind, string]> = [
  ["orders", "Orders"],
  ["items", "Items sold"],
  ["payments", "Payments & refunds"],
  ["closes", "Day closes"],
  ["stock", "Stock movements"],
  ["gst", "GST invoices"],
];
const daysAgo = (n: number) => istDate(new Date(Date.now() - n * 86_400_000));
const shortDate = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportCsv(r: SalesReport): string {
  const rupees = (p: number) => (p / 100).toFixed(2);
  const rows: Array<Array<string | number>> = [
    ["Report", `${r.from} to ${r.to}`],
    [],
    ["Date", "Orders", "Net sales (INR)"],
    ...r.byDay.map((d) => [d.date, d.orders, rupees(d.netPaise)]),
    [],
    ["Café", "Orders", "Cancelled", "Online", "Counter", "Net sales (INR)"],
    ...r.byCafe.map((c) => [c.name, c.orders, c.cancelled, c.online, c.counter, rupees(c.netPaise)]),
    [],
    ["Item", "Quantity", "Revenue (INR)"],
    ...r.topItems.map((i) => [i.name, i.quantity, rupees(i.revenuePaise)]),
    [],
    ["Day close", "Café", "Closed by", "Expected cash (INR)", "Counted cash (INR)", "Difference (INR)", "Note"],
    ...r.closes.map((c) => [c.businessDate, c.outlet, c.closedBy, rupees(c.expectedCashPaise), rupees(c.countedCashPaise), rupees(c.variancePaise), c.note ?? ""]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function Reports({ setup }: { setup: AdminSetup }) {
  const [preset, setPreset] = useState<"today" | "7" | "30" | "custom">("7");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(daysAgo(0));
  const [outletId, setOutletId] = useState("");
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (p: "today" | "7" | "30") => {
    setPreset(p);
    setFrom(daysAgo(p === "today" ? 0 : Number(p) - 1));
    setTo(daysAgo(0));
  };

  useEffect(() => {
    let live = true;
    setError(null);
    api.admin.reports({ from, to, outletId: outletId || undefined }).then(
      (r) => live && setReport(r),
      (e: ApiError) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [from, to, outletId]);

  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([reportCsv(report)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `brew-haven-${report.from}-to-${report.to}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const r = report;
  const maxDay = Math.max(1, ...(r?.byDay.map((d) => d.netPaise) ?? [1]));
  const maxHour = Math.max(1, ...(r?.busiestHours.map((h) => h.orders) ?? [1]));
  const methodTotal = Object.values(r?.byMethod ?? {}).reduce((a, b) => a + b, 0) || 1;

  return (
    <section className="panel reports">
      <header className="items-head">
        <h2>Reports</h2>
        <div className="report-controls">
          {(["today", "7", "30"] as const).map((p) => (
            <button key={p} className={preset === p ? "chip chip-on" : "chip"} onClick={() => choose(p)}>
              {p === "today" ? "Today" : `Last ${p} days`}
            </button>
          ))}
          <label className="date-range">
            <input type="date" value={from} max={to} onChange={(e) => (setPreset("custom"), setFrom(e.target.value))} aria-label="From" />
            <span>to</span>
            <input type="date" value={to} min={from} max={daysAgo(0)} onChange={(e) => (setPreset("custom"), setTo(e.target.value))} aria-label="To" />
          </label>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Café">
            <option value="">All cafés</option>
            {setup.outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost" onClick={download} disabled={!r}>
            Summary CSV
          </button>
        </div>
      </header>
      <div className="export-row" role="group" aria-label="Download for your accountant">
        <span className="muted small">Download for your accountant, same dates and café:</span>
        {EXPORTS.map(([kind, label]) => (
          <button
            key={kind}
            className="chip"
            disabled={exporting !== null}
            onClick={async () => {
              setExporting(kind);
              setError(null);
              try {
                await api.admin.exportCsv(kind, { from, to, outletId: outletId || undefined });
              } catch (e) {
                setError((e as ApiError).message);
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === kind ? "Preparing…" : label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!r && !error && <p className="muted">Loading…</p>}
      {r && (
        <>
          <div className="stat-tiles">
            <Tile label="Net sales" value={formatInr(r.totals.netPaise)} sub={r.totals.refundedPaise ? `after ${formatInr(r.totals.refundedPaise)} refunded` : "no refunds"} />
            <Tile label="Orders" value={String(r.totals.orders)} sub={`${r.totals.cancelled} cancelled${r.totals.open ? `, ${r.totals.open} still open` : ""}`} />
            <Tile label="Average order" value={formatInr(r.totals.averageOrderPaise)} />
            <Tile label="Taken" value={formatInr(r.totals.capturedPaise)} sub="before refunds" />
          </div>

          <div className="report-grid">
            <article className="report-card wide">
              <h3>Sales by day</h3>
              {r.byDay.length === 0 ? (
                <p className="muted">No sales in this period.</p>
              ) : (
                <ol className="bars" aria-label="Net sales by day">
                  {r.byDay.map((d) => (
                    <li key={d.date} title={`${shortDate(d.date)}: ${formatInr(d.netPaise)}, ${d.orders} orders`}>
                      <span className="bar" style={{ height: `${Math.max(2, (d.netPaise / maxDay) * 100)}%` }} />
                      <span className="bar-label">{shortDate(d.date)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </article>

            <article className="report-card">
              <h3>By café</h3>
              <table className="items-table compact">
                <thead>
                  <tr>
                    <th>Café</th>
                    <th className="num">Orders</th>
                    <th className="num">Online / counter</th>
                    <th className="num">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byCafe.map((c) => (
                    <tr key={c.outletId}>
                      <td>{c.name}</td>
                      <td className="num">{c.orders}</td>
                      <td className="num">
                        {c.online} / {c.counter}
                      </td>
                      <td className="num">{formatInr(c.netPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article className="report-card">
              <h3>How customers paid</h3>
              <ul className="method-list">
                {Object.entries(r.byMethod)
                  .sort((a, b) => b[1] - a[1])
                  .map(([m, p]) => (
                    <li key={m}>
                      <span>{METHOD_LABEL[m] ?? m}</span>
                      <span className="meter" aria-hidden>
                        <span style={{ width: `${(p / methodTotal) * 100}%` }} />
                      </span>
                      <strong>{formatInr(p)}</strong>
                    </li>
                  ))}
                {Object.keys(r.byMethod).length === 0 && <li className="muted">No payments yet.</li>}
              </ul>
            </article>

            <article className="report-card">
              <h3>Top items</h3>
              <ol className="top-items">
                {r.topItems.map((i) => (
                  <li key={i.name}>
                    <span>{i.name}</span>
                    <span className="muted">×{i.quantity}</span>
                    <strong>{formatInr(i.revenuePaise)}</strong>
                  </li>
                ))}
                {r.topItems.length === 0 && <li className="muted">Nothing sold yet.</li>}
              </ol>
            </article>

            <article className="report-card">
              <h3>Busiest hours</h3>
              <ul className="hours">
                {r.busiestHours.map((h) => (
                  <li key={h.hour}>
                    <span>{hourLabel(h.hour)}</span>
                    <span className="meter" aria-hidden>
                      <span style={{ width: `${(h.orders / maxHour) * 100}%` }} />
                    </span>
                    <span className="muted">{h.orders}</span>
                  </li>
                ))}
                {r.busiestHours.length === 0 && <li className="muted">No orders yet.</li>}
              </ul>
            </article>

            <article className="report-card wide">
              <h3>Day closes</h3>
              {r.closes.length === 0 ? (
                <p className="muted">No days closed in this period. The cashier closes the day from the Today tab.</p>
              ) : (
                <table className="items-table compact">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Café</th>
                      <th>Closed by</th>
                      <th className="num">Expected cash</th>
                      <th className="num">Counted</th>
                      <th className="num">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.closes.map((c) => (
                      <tr key={c.id}>
                        <td className="nowrap">{shortDate(c.businessDate)}</td>
                        <td>{c.outlet}</td>
                        <td>{c.closedBy}</td>
                        <td className="num">{formatInr(c.expectedCashPaise)}</td>
                        <td className="num">{formatInr(c.countedCashPaise)}</td>
                        <td className={`num ${c.variancePaise === 0 ? "ok" : "warn"}`} title={c.note ?? undefined}>
                          {c.variancePaise === 0 ? "Matched" : `${c.variancePaise < 0 ? "Short" : "Over"} ${formatInr(Math.abs(c.variancePaise))}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          </div>
          <FunnelCard from={from} to={to} outletId={outletId} />
          <SpeedCard from={from} to={to} outletId={outletId} />
          <GstCard from={from} to={to} outletId={outletId} />
        </>
      )}
    </section>
  );
}

/** How many visits to the ordering page got to each step, and how many paid. Counts only. */
function FunnelCard({ from, to, outletId }: { from: string; to: string; outletId: string }) {
  const [f, setF] = useState<Awaited<ReturnType<typeof api.admin.funnel>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    api.admin.funnel({ from, to, outletId: outletId || undefined }).then(
      (r) => live && setF(r),
      (e: ApiError) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [from, to, outletId]);
  const top = Math.max(1, f?.steps[0]?.visits ?? 1);
  return (
    <article className="report-card wide funnel-card">
      <h3>Online ordering</h3>
      {error && <p className="error">{error}</p>}
      {!f && !error && <p className="muted">Loading…</p>}
      {f && (f.steps[0]!.visits === 0 ? (
        <p className="muted">No visits to the ordering page in this period.</p>
      ) : (
        <>
          <ul className="method-list funnel">
            {f.steps.map((s) => (
              <li key={s.step}>
                <span>{s.label}</span>
                <span className="meter" aria-hidden>
                  <span style={{ width: `${(s.visits / top) * 100}%` }} />
                </span>
                <strong>{s.visits}</strong>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {f.conversionPct === null ? "" : `${f.conversionPct}% of visits ended in a paid order. `}Counts of visits only: nobody's name, phone or device is recorded. People who turn on "Do not track" aren't counted.
          </p>
        </>
      ))}
    </article>
  );
}

const mins = (sec: number | null) => {
  if (sec === null) return "–";
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
};
const speedText = (s: SpeedSpread) => (s.medianSec === null ? "–" : `${mins(s.medianSec)} (slowest 1 in 10: ${mins(s.p90Sec)})`);
const TARGET_KEY = "bh:speed-target";

/** How fast the kitchen turns orders round, and which orders ran late against the owner's target. */
function SpeedCard({ from, to, outletId }: { from: string; to: string; outletId: string }) {
  const [target, setTarget] = useState(() => {
    try {
      return Number(localStorage.getItem(TARGET_KEY)) || 10;
    } catch {
      return 10;
    }
  });
  const [k, setK] = useState<KitchenSpeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    api.admin.kitchenSpeed({ from, to, outletId: outletId || undefined, targetMinutes: target }).then(
      (r) => live && setK(r),
      (e: ApiError) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [from, to, outletId, target]);
  const saveTarget = (n: number) => {
    if (!Number.isFinite(n) || n < 1 || n > 120) return;
    setTarget(n);
    try {
      localStorage.setItem(TARGET_KEY, String(n));
    } catch {
      /* ignore */
    }
  };
  const maxHour = Math.max(1, ...(k?.byHour.map((h) => h.ticket.medianSec ?? 0) ?? [1]));
  return (
    <article className="report-card wide speed-card">
      <header className="speed-head">
        <h3>Kitchen speed</h3>
        <label className="small">
          Late after
          <input type="number" min={1} max={120} value={target} onChange={(e) => saveTarget(Number(e.target.value))} aria-label="Late after, minutes" />
          minutes
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {!k && !error && <p className="muted">Loading…</p>}
      {k && k.totals.orders === 0 && <p className="muted">No orders were marked ready in this period.</p>}
      {k && k.totals.orders > 0 && (
        <>
          <div className="stat-tiles">
            <Tile label="Paid to ready" value={mins(k.totals.ticket.medianSec)} sub={`typical; slowest 1 in 10: ${mins(k.totals.ticket.p90Sec)}`} />
            <Tile label="Late" value={`${k.totals.late} of ${k.totals.orders}`} sub={`${k.totals.latePct}% over ${k.targetMinutes} min`} />
            <Tile label="Waiting to start" value={mins(k.totals.waitToStart.medianSec)} sub="paid until the kitchen taps Start" />
            <Tile label="Waiting for pickup" value={mins(k.totals.waitForPickup.medianSec)} sub="ready until handed over" />
          </div>
          <p className="muted small">
            Typical is the middle order. Times run from payment, so a long wait to start usually means the kitchen was busy or the ticket was missed.
            {k.stillOpen ? ` ${k.stillOpen} order${k.stillOpen === 1 ? " is" : "s are"} not ready yet and aren't counted.` : ""}
          </p>
          {k.byCafe.length > 1 && (
            <table className="items-table compact">
              <thead>
                <tr>
                  <th>Café</th>
                  <th className="num">Orders</th>
                  <th>Paid to ready</th>
                  <th>Making</th>
                  <th className="num">Late</th>
                </tr>
              </thead>
              <tbody>
                {k.byCafe.map((c) => (
                  <tr key={c.outletId}>
                    <td>{c.outlet}</td>
                    <td className="num">{c.orders}</td>
                    <td>{speedText(c.ticket)}</td>
                    <td>{mins(c.making.medianSec)}</td>
                    <td className="num">{c.orders ? `${c.late} (${c.latePct}%)` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4 className="small">Typical paid-to-ready time by hour</h4>
          <ul className="hours">
            {k.byHour.map((h) => (
              <li key={h.hour}>
                <span>{hourLabel(h.hour)}</span>
                <span className={`meter${(h.ticket.medianSec ?? 0) > k.targetMinutes * 60 ? " over" : ""}`} aria-hidden>
                  <span style={{ width: `${((h.ticket.medianSec ?? 0) / maxHour) * 100}%` }} />
                </span>
                <span className="muted">
                  {mins(h.ticket.medianSec)} · {h.orders} order{h.orders === 1 ? "" : "s"}
                  {h.late ? `, ${h.late} late` : ""}
                </span>
              </li>
            ))}
          </ul>
          {k.slowest.length > 0 && (
            <table className="items-table compact">
              <caption className="muted small">Slowest late orders</caption>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Café</th>
                  <th>Paid at</th>
                  <th className="num">Items</th>
                  <th>Paid to ready</th>
                </tr>
              </thead>
              <tbody>
                {k.slowest.map((o) => (
                  <tr key={o.orderId}>
                    <td>
                      {o.code}
                      {o.channel === "COUNTER" ? " · counter" : ""}
                      {o.hadIssue && <span className="muted small"> · item unavailable</span>}
                    </td>
                    <td>{o.outlet}</td>
                    <td className="nowrap">{new Date(o.placedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</td>
                    <td className="num">{o.items}</td>
                    <td className="warn">{mins(o.ticketSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </article>
  );
}

/** GST for the return: sales by rate, by café, and the invoice numbers issued. */
function GstCard({ from, to, outletId }: { from: string; to: string; outletId: string }) {
  const [g, setG] = useState<GstSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    api.admin.gstSummary({ from, to, outletId: outletId || undefined }).then(
      (r) => live && setG(r),
      (e: ApiError) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [from, to, outletId]);
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
  return (
    <article className="report-card wide gst-card">
      <h3>GST summary</h3>
      {error && <p className="error">{error}</p>}
      {!g && !error && <p className="muted">Loading…</p>}
      {g && (
        <>
          <p className="muted small">
            {g.gstin ? `GSTIN ${g.gstin}${g.legalName ? `, ${g.legalName}` : ""}.` : "No GSTIN on file yet, so receipts are plain receipts. Add it in Café settings."} Restaurant service, SAC {g.sac}. All sales are within the state, so GST is split
            equally into CGST and SGST. Values are after any items removed or swapped.
          </p>
          {g.totals.invoices === 0 ? (
            <p className="muted">No invoices in this period.</p>
          ) : (
            <>
              <table className="items-table compact">
                <thead>
                  <tr>
                    <th>Rate</th>
                    <th className="num">Invoices</th>
                    <th className="num">Taxable value</th>
                    <th className="num">CGST</th>
                    <th className="num">SGST</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {g.byRate.map((r) => (
                    <tr key={r.rateBps}>
                      <td>{pct(r.rateBps)}</td>
                      <td className="num">{r.invoices}</td>
                      <td className="num">{formatInr(r.taxablePaise)}</td>
                      <td className="num">{formatInr(r.cgstPaise)}</td>
                      <td className="num">{formatInr(r.sgstPaise)}</td>
                      <td className="num">{formatInr(r.totalPaise)}</td>
                    </tr>
                  ))}
                  {g.byRate.length > 1 && (
                    <tr className="total-row">
                      <td>All rates</td>
                      <td className="num">{g.totals.invoices}</td>
                      <td className="num">{formatInr(g.totals.taxablePaise)}</td>
                      <td className="num">{formatInr(g.totals.cgstPaise)}</td>
                      <td className="num">{formatInr(g.totals.sgstPaise)}</td>
                      <td className="num">{formatInr(g.totals.totalPaise)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {g.byCafe.length > 1 && (
                <table className="items-table compact">
                  <thead>
                    <tr>
                      <th>Café</th>
                      <th className="num">Invoices</th>
                      <th className="num">Taxable value</th>
                      <th className="num">GST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.byCafe.map((c) => (
                      <tr key={c.outlet}>
                        <td>{c.outlet}</td>
                        <td className="num">{c.invoices}</td>
                        <td className="num">{formatInr(c.taxablePaise)}</td>
                        <td className="num">{formatInr(c.cgstPaise + c.sgstPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          {g.documents.length > 0 && (
            <table className="items-table compact">
              <caption className="muted small">Invoice numbers issued</caption>
              <thead>
                <tr>
                  <th>Café</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Issued</th>
                  <th className="num">Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {g.documents.map((d) => (
                  <tr key={d.series}>
                    <td>{d.outlet}</td>
                    <td className="nowrap">{d.first}</td>
                    <td className="nowrap">{d.last}</td>
                    <td className="num">{d.issued}</td>
                    <td className="num">{d.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </article>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

// ---------- Payment checks ----------

const CHECK_LABEL: Record<string, string> = {
  REFUND_FAILED: "Refund failed",
  REFUND_STUCK: "Refund stuck",
  PAID_NOT_SERVED: "Paid, not served",
  UPI_NO_REFERENCE: "UPI, no reference",
};

function PaymentChecks({ setup }: { setup: AdminSetup }) {
  const [outletId, setOutletId] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.paymentChecks>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api.admin.paymentChecks(outletId || undefined).then(setData, (e: ApiError) => setError(e.message));
  }, [outletId]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const act = data?.items.filter((i) => i.severity === "act").length ?? 0;
  return (
    <section className="panel activity">
      <header className="items-head">
        <h2>Payment checks</h2>
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Filter by café">
          <option value="">All cafés</option>
          {setup.outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </header>
      <p className="muted small">The last 30 days: refunds that failed or are stuck, money taken for orders that weren't served, and counter UPI payments with no reference to match on the bank statement.</p>
      {error && <p className="error">{error}</p>}
      {data && (
        <p className={act ? "banner-inline note" : "ok"}>{act ? `${act} need${act === 1 ? "s" : ""} action.` : "Nothing needs action."}</p>
      )}
      <div className="table-wrap">
        <table className="items-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Order</th>
              <th>Check</th>
              <th className="num">Amount</th>
              <th>What to do</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((i, n) => (
              <tr key={`${i.orderId}-${i.kind}-${n}`}>
                <td className="nowrap">{when(i.at)}</td>
                <td className="nowrap">
                  {i.orderCode ?? "—"} <small className="muted">{i.outlet}</small>
                </td>
                <td className="nowrap">
                  <span className={`pill ${i.severity === "act" ? "pill-failed" : "pill-logged"}`}>{CHECK_LABEL[i.kind] ?? i.kind}</span>
                </td>
                <td className="num">{formatInr(i.amountPaise)}</td>
                <td>{i.message}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  All clear.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
