import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { AdminSetup, OutletWithStations } from "@brew-haven/contracts";
import { formatInr } from "@brew-haven/domain";
import { ApiError, CUSTOMER_URL, TENANT, api, type ActivityEntry, type AdminItem, type ItemInput } from "./api";

/** Owner self-service (D-17): cafés, kitchens, menu, staff, settings and QR codes. */
type Section = "cafes" | "menu" | "staff" | "settings" | "messages" | "activity";

export function Admin({ onOutletsChanged }: { onOutletsChanged: () => void }) {
  const [setup, setSetup] = useState<AdminSetup | null>(null);
  const [section, setSection] = useState<Section>("cafes");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
      {section === "cafes" && <Cafes setup={setup} act={act} onOutletsChanged={onOutletsChanged} />}
      {section === "menu" && <MenuAdmin setup={setup} act={act} />}
      {section === "staff" && <StaffAdmin setup={setup} act={act} />}
      {section === "settings" && <Settings setup={setup} act={act} />}
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
        <button className="add-card" onClick={() => setAdding(true)}>
          <span>+</span> Add a new café
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
      <h3>New café</h3>
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
  const link = `${CUSTOMER_URL}/${TENANT}/${outlet.slug}`;

  return (
    <section className="panel cafe-card">
      <header>
        {editing ? (
          <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Café name" />
        ) : (
          <h3>{outlet.name}</h3>
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
      <h4>Kitchens</h4>
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
  const link = `${CUSTOMER_URL}/${TENANT}/${outlet.slug}`;
  const [svg, setSvg] = useState<string>("");
  const [png, setPng] = useState<string>("");
  useEffect(() => {
    void QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#120D0A", light: "#FBF6EC" } }).then(setSvg);
    void QRCode.toDataURL(link, { margin: 2, width: 1200, errorCorrectionLevel: "M", color: { dark: "#120D0A", light: "#FFFFFF" } }).then(setPng);
  }, [link]);
  return (
    <div className="modal-backdrop qr-backdrop" onClick={onClose}>
      <div className="modal qr-modal" role="dialog" aria-modal="true" aria-label={`QR code for ${outlet.name}`} onClick={(e) => e.stopPropagation()}>
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
        <h3>Menu sections</h3>
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
              <h3>{cat.name}</h3>
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
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className={i.active ? "" : "off"}>
                      <td>
                        <span className={`dot ${i.isVeg ? "veg" : "nonveg"}`} aria-label={i.isVeg ? "Veg" : "Non-veg"} /> {i.name}
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal item-modal" role="dialog" aria-modal="true" aria-label={item ? `Edit ${item.name}` : "New item"} onClick={(e) => e.stopPropagation()}>
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
        <h3>Team</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Cafés</th>
                <th>Status</th>
                <th />
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
        <h3>Add a team member</h3>
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

function Settings({ setup, act }: { setup: AdminSetup; act: Act }) {
  const b = setup.tenant.branding;
  const [displayName, setDisplayName] = useState(b.displayName);
  const [tagline, setTagline] = useState(b.tagline ?? "");
  const [greeting, setGreeting] = useState(b.greeting ?? "");
  const [managerName, setManagerName] = useState(b.managerName ?? "");
  const [gst, setGst] = useState(String(setup.tenant.taxRateBps / 100));
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
            }),
          "Settings saved. Customers see them straight away.",
        );
      }}
    >
      <h3>What customers see</h3>
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
      <h3>Tax</h3>
      <label>
        GST rate included in menu prices (%)
        <input value={gst} onChange={(e) => setGst(e.target.value)} inputMode="decimal" />
        <small className="muted">Confirm the right rate with your accountant. Restaurants without input tax credit usually use 5%.</small>
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
        <h3>Activity</h3>
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

const STATUS_LABEL: Record<string, string> = { SENT: "Sent", LOGGED: "Preview only", FAILED: "Failed, retrying", QUEUED: "Sending" };

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
        <h3>Customer messages</h3>
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
