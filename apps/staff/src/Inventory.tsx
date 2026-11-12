import { useEffect, useMemo, useState } from "react";
import type { AdminSetup, StaffRole } from "@brew-haven/contracts";
import { formatQuantity } from "@brew-haven/domain";
import { ApiError, api, type IngredientStock, type RecipeItem, type StockMove, type StockReportRow, type Unit } from "./api";

const KIND_LABEL: Record<StockMove["kind"], string> = { RECEIVE: "Received", SALE: "Sold", WASTE: "Wasted", COUNT: "Counted" };
const UNIT_WORD: Record<Unit, string> = { g: "grams", ml: "ml", pc: "pieces" };
const STATUS_PILL: Record<IngredientStock["status"], [string, string]> = { OK: ["pill-sent", "OK"], LOW: ["pill-low", "Low"], OUT: ["pill-failed", "Out"], UNTRACKED: ["", "Not counted yet"] };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Ingredient stock at one café: deliveries, waste and shelf counts. Every team member of the café can use it. */
export function IngredientStockPanel({ outletId }: { outletId: string; role: StaffRole }) {
  const [list, setList] = useState<IngredientStock[] | null>(null);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({ ingredientId: "", kind: "RECEIVE" as "RECEIVE" | "WASTE" | "COUNT", quantity: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = () =>
    Promise.all([api.inventory(outletId), api.stockHistory(outletId)])
      .then(([inv, hist]) => {
        const active = inv.ingredients.filter((i) => i.active);
        setList(active);
        setMoves(hist.slice(0, 15));
        setForm((f) => (f.ingredientId || !active[0] ? f : { ...f, ingredientId: active[0].id }));
      })
      .catch((e: ApiError) => setError(e.message));
  useEffect(() => void load(), [outletId]);

  if (!list) return error ? <p className="error">{error}</p> : null;
  if (list.length === 0) return null; // The owner hasn't set up ingredients yet.
  const chosen = list.find((i) => i.id === form.ingredientId);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = Math.floor(Number(form.quantity));
    if (!chosen || !Number.isFinite(q) || q < 0 || (form.kind !== "COUNT" && q === 0)) return setError("Enter an amount.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.recordStock({ outletId, ingredientId: chosen.id, kind: form.kind, quantity: q, note: form.note.trim() || undefined });
      setDone(`${chosen.name}: ${formatQuantity(r.onHand, r.unit)} on hand now`);
      setForm((f) => ({ ...f, quantity: "", note: "" }));
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ingredients" aria-labelledby="ing-h">
      <h2 id="ing-h">Ingredients</h2>
      <p className="muted small">Orders take ingredients out automatically, using the owner's recipes. Record deliveries and waste here, and count the shelf now and then to correct the total.</p>
      <form className="stock-form" onSubmit={save}>
        <label>
          Ingredient
          <select value={form.ingredientId} onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}>
            {list.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          What happened
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}>
            <option value="RECEIVE">Delivery received</option>
            <option value="WASTE">Wasted or spilt</option>
            <option value="COUNT">Counted the shelf</option>
          </select>
        </label>
        <label>
          {form.kind === "COUNT" ? "On the shelf" : "Amount"} ({chosen ? UNIT_WORD[chosen.unit] : ""})
          <input type="number" min={0} inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
        </label>
        <label>
          Note <span className="muted">(optional)</span>
          <input value={form.note} maxLength={140} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={form.kind === "RECEIVE" ? "e.g. Supplier invoice 1182" : ""} />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {done && !error && (
        <p className="ok" role="status">
          {done}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>On hand</th>
            <th>Status</th>
            <th>Used, last 7 days</th>
          </tr>
        </thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.id}>
              <td>{i.name}</td>
              <td className="nowrap">{formatQuantity(i.onHand, i.unit)}</td>
              <td>
                <span className={`pill ${STATUS_PILL[i.status][0]}`}>{STATUS_PILL[i.status][1]}</span>
              </td>
              <td className="nowrap">{formatQuantity(i.usedLast7Days, i.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {moves.length > 0 && (
        <>
          <h3>Recent changes</h3>
          <ul className="moves">
            {moves.map((m) => (
              <li key={m.id}>
                <span className="muted nowrap">{when(m.at)}</span> {KIND_LABEL[m.kind]} {m.ingredient}: {m.quantity > 0 ? "+" : ""}
                {formatQuantity(m.quantity, m.unit)}
                {m.by ? ` · ${m.by}` : ""}
                {m.note ? ` · ${m.note}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;
type Row = { when: string; ingredientId: string; quantity: string };
const ALWAYS = "";
const choiceKey = (g: string, o: string) => `${g}\u0000${o}`;

/** Owner: the ingredient list, low-stock levels per café, and what each menu item uses. */
export function InventoryAdmin({ setup, act }: { setup: AdminSetup; act: Act }) {
  const [outletId, setOutletId] = useState(setup.outlets[0]?.id ?? "");
  const [stock, setStock] = useState<IngredientStock[] | null>(null);
  const [recipes, setRecipes] = useState<RecipeItem[] | null>(null);
  const [low, setLow] = useState<Awaited<ReturnType<typeof api.admin.lowStock>>["items"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newIng, setNewIng] = useState({ name: "", unit: "g" as Unit });

  const load = () =>
    Promise.all([outletId ? api.inventory(outletId) : Promise.resolve({ ingredients: [] }), api.admin.recipes(), api.admin.lowStock()])
      .then(([inv, rec, l]) => {
        setStock(inv.ingredients);
        setRecipes(rec.items);
        setLow(l.items);
      })
      .catch((e: ApiError) => setError(e.message));
  useEffect(() => void load(), [outletId]);
  const run = async (fn: () => Promise<unknown>, msg: string) => (await act(fn, msg)) && (await load(), true);

  if (!stock || !recipes) return <p className="muted">{error ?? "Loading…"}</p>;
  return (
    <div className="inventory-admin">
      <section className="panel">
        <h2>Running low</h2>
        {low.length === 0 ? (
          <p className="ok">Nothing is low at any café.</p>
        ) : (
          <ul className="moves">
            {low.map((l) => (
              <li key={`${l.outlet}-${l.ingredient}`}>
                <span className={`pill ${l.status === "OUT" ? "pill-failed" : "pill-low"}`}>{l.status === "OUT" ? "Out" : "Low"}</span> {l.ingredient} at {l.outlet}: {formatQuantity(l.onHand, l.unit)}
                {l.lowAt !== null ? ` (low at ${formatQuantity(l.lowAt, l.unit)})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <header className="items-head">
          <h2>Ingredients</h2>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Café for stock and low-stock levels">
            {setup.outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </header>
        <p className="muted small">Amounts are whole grams, millilitres or pieces. A café is warned when it gets down to its low-stock level.</p>
        <form
          className="inline-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newIng.name.trim() && (await run(() => api.admin.createIngredient({ name: newIng.name.trim(), unit: newIng.unit }), "Ingredient added"))) setNewIng({ ...newIng, name: "" });
          }}
        >
          <input value={newIng.name} onChange={(e) => setNewIng({ ...newIng, name: e.target.value })} placeholder="New ingredient, e.g. Full-cream milk" maxLength={60} aria-label="New ingredient name" />
          <select value={newIng.unit} onChange={(e) => setNewIng({ ...newIng, unit: e.target.value as Unit })} aria-label="Measured in">
            <option value="g">grams</option>
            <option value="ml">ml</option>
            <option value="pc">pieces</option>
          </select>
          <button className="btn btn-primary">Add</button>
        </form>
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>On hand</th>
                <th>Low at</th>
                <th>Used in</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {stock.map((i) => (
                <tr key={i.id} className={i.active ? "" : "off"}>
                  <td>{i.name}</td>
                  <td className="nowrap">{formatQuantity(i.onHand, i.unit)}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="—"
                      defaultValue={i.lowAt ?? ""}
                      key={`${outletId}-${i.id}-${i.lowAt}`}
                      aria-label={`Low-stock level for ${i.name}, in ${UNIT_WORD[i.unit]}`}
                      className="num-input"
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value)));
                        if (v !== i.lowAt) void run(() => api.admin.setLowStock({ outletId, ingredientId: i.id, lowAt: v }), "Low-stock level saved");
                      }}
                    />{" "}
                    <span className="muted small">{i.unit}</span>
                  </td>
                  <td>{i.usedIn === 1 ? "1 item" : `${i.usedIn} items`}</td>
                  <td className="nowrap">
                    <button
                      className="link-btn"
                      onClick={() => {
                        const n = window.prompt("Rename ingredient", i.name)?.trim();
                        if (n && n !== i.name) void run(() => api.admin.updateIngredient(i.id, { name: n }), "Ingredient renamed");
                      }}
                    >
                      Rename
                    </button>{" "}
                    <button className="link-btn" onClick={() => run(() => api.admin.updateIngredient(i.id, { active: !i.active }), i.active ? "Ingredient retired" : "Ingredient back in use")}>
                      {i.active ? "Retire" : "Bring back"}
                    </button>
                  </td>
                </tr>
              ))}
              {stock.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No ingredients yet. Add the ones you want to track, then give menu items a recipe.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {stock.length > 0 && <StockReport outletId={outletId} cafe={setup.outlets.find((o) => o.id === outletId)?.name ?? ""} />}
      {stock.length > 0 && <RecipeEditor items={recipes} ingredients={stock} onSave={(itemId, rows) => run(() => api.admin.setRecipe(itemId, rows), "Recipe saved")} />}
    </div>
  );
}

function RecipeEditor({
  items,
  ingredients,
  onSave,
}: {
  items: RecipeItem[];
  ingredients: IngredientStock[];
  onSave: (itemId: string, rows: Array<{ groupName?: string; optionName?: string; ingredientId: string; quantity: number }>) => Promise<boolean>;
}) {
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const item = items.find((i) => i.id === itemId);
  const fromItem = (it?: RecipeItem): Row[] =>
    it?.rows.map((r) => ({ when: r.groupName ? choiceKey(r.groupName, r.optionName!) : ALWAYS, ingredientId: r.ingredientId, quantity: String(r.quantity) })) ?? [];
  const [rows, setRows] = useState<Row[]>(() => fromItem(item));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setRows(fromItem(item));
    setProblem(null);
  }, [itemId, items]);
  const unitOf = useMemo(() => new Map(ingredients.map((i) => [i.id, i.unit])), [ingredients]);
  const active = ingredients.filter((i) => i.active);
  const withRecipe = new Set(items.filter((i) => i.rows.length).map((i) => i.id));

  const save = async () => {
    const out = [];
    for (const r of rows) {
      const q = Math.trunc(Number(r.quantity));
      if (!r.ingredientId || !q) return setProblem("Every line needs an ingredient and an amount.");
      if (r.when === ALWAYS && q < 0) return setProblem("The base recipe can't use a negative amount. Use a minus amount only on a choice, e.g. oat milk replacing milk.");
      const [groupName, optionName] = r.when === ALWAYS ? [] : r.when.split("\u0000");
      out.push({ ...(groupName ? { groupName, optionName } : {}), ingredientId: r.ingredientId, quantity: q });
    }
    setProblem(null);
    await onSave(itemId, out);
  };

  return (
    <section className="panel">
      <header className="items-head">
        <h2>Recipes</h2>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Menu item">
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
              {withRecipe.has(i.id) ? " ✓" : ""}
            </option>
          ))}
        </select>
      </header>
      <p className="muted small">
        What one serving uses. Add lines for a choice when it changes the recipe: for oat milk, take away the milk (a minus amount) and add the oat milk. Items without a recipe don't touch ingredient stock.
      </p>
      {item && (
        <>
          <div className="table-wrap">
            <table className="items-table recipe-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Ingredient</th>
                  <th>Amount</th>
                  <th>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, n) => (
                  <tr key={n}>
                    <td>
                      <select value={r.when} onChange={(e) => setRows(rows.map((x, k) => (k === n ? { ...x, when: e.target.value } : x)))} aria-label={`Line ${n + 1}: when`}>
                        <option value={ALWAYS}>Every serving</option>
                        {item.choices.map((c) => (
                          <option key={choiceKey(c.group, c.option)} value={choiceKey(c.group, c.option)}>
                            {c.group}: {c.option}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={r.ingredientId} onChange={(e) => setRows(rows.map((x, k) => (k === n ? { ...x, ingredientId: e.target.value } : x)))} aria-label={`Line ${n + 1}: ingredient`}>
                        <option value="">Choose…</option>
                        {ingredients
                          .filter((i) => i.active || i.id === r.ingredientId)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="nowrap">
                      <input
                        type="number"
                        inputMode="numeric"
                        className="num-input"
                        value={r.quantity}
                        onChange={(e) => setRows(rows.map((x, k) => (k === n ? { ...x, quantity: e.target.value } : x)))}
                        aria-label={`Line ${n + 1}: amount`}
                      />{" "}
                      <span className="muted small">{unitOf.get(r.ingredientId) ?? ""}</span>
                    </td>
                    <td>
                      <button className="link-btn danger" onClick={() => setRows(rows.filter((_, k) => k !== n))} aria-label={`Remove line ${n + 1}`}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No recipe yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {problem && (
            <p className="error" role="alert">
              {problem}
            </p>
          )}
          <div className="row-btns">
            <button className="btn btn-ghost" onClick={() => setRows([...rows, { when: ALWAYS, ingredientId: active[0]?.id ?? "", quantity: "" }])}>
              Add a line
            </button>
            <button className="btn btn-primary" onClick={save}>
              Save recipe
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const signed = (n: number, unit: Unit) => (n > 0 ? "+" : n < 0 ? "−" : "") + formatQuantity(Math.abs(n), unit);

/** Owner: what each ingredient should have gone down by, against what was counted. */
function StockReport({ outletId, cafe }: { outletId: string; cafe: string }) {
  const [to, setTo] = useState(() => istDate(new Date()));
  const [from, setFrom] = useState(() => istDate(new Date(Date.now() - 6 * 86_400_000)));
  const [rows, setRows] = useState<StockReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    setError(null);
    api.admin.stockReport({ outletId, from, to }).then((r) => setRows(r.rows), (e: ApiError) => setError(e.message));
  }, [outletId, from, to]);

  const download = () => {
    if (!rows) return;
    const head = ["Ingredient", "Unit", "Opening", "Received", "Used by sales", "Wasted", "Count difference", "Closing", "Difference % of use"];
    const csv = [head, ...rows.map((r) => [r.name, r.unit, r.opening, r.received, r.used, r.wasted, r.variance, r.closing, r.variancePct ?? ""])]
      .map((line) => line.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `stock-${cafe.toLowerCase().replace(/\W+/g, "-")}-${from}-to-${to}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel">
      <header className="items-head">
        <h2>Stock report: {cafe}</h2>
        <div className="report-controls">
          <label className="date-range">
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Stock report from" />
            <span>to</span>
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Stock report to" />
          </label>
          <button className="btn btn-ghost" onClick={download} disabled={!rows?.length}>
            Download CSV
          </button>
        </div>
      </header>
      <p className="muted small">
        Opening + received − used by sales − wasted, against what the team counted. A minus count difference is stock that went missing beyond the recipes and recorded waste: over-pouring, unrecorded waste, or theft.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="items-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">Opening</th>
              <th className="num">Received</th>
              <th className="num">Used by sales</th>
              <th className="num">Wasted</th>
              <th className="num">Count difference</th>
              <th className="num">Closing</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.ingredientId}>
                <td>{r.name}</td>
                <td className="num nowrap">{formatQuantity(r.opening, r.unit)}</td>
                <td className="num nowrap">{formatQuantity(r.received, r.unit)}</td>
                <td className="num nowrap">{formatQuantity(r.used, r.unit)}</td>
                <td className="num nowrap">{formatQuantity(r.wasted, r.unit)}</td>
                <td className={`num nowrap ${r.variance < 0 ? "short" : ""}`}>
                  {r.variance ? signed(r.variance, r.unit) : "—"}
                  {r.variancePct !== null && r.variance !== 0 && <small className="muted"> ({r.variancePct > 0 ? "+" : ""}{r.variancePct}% of use)</small>}
                </td>
                <td className="num nowrap">{formatQuantity(r.closing, r.unit)}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No stock recorded at this café in these dates.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
