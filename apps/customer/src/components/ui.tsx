import type { ReactNode } from "react";
import { formatInr } from "@brew-haven/domain";

export const Rs = ({ paise }: { paise: number }) => <span className="price">{formatInr(paise).replace(".00", "")}</span>;

/** Indian veg / non-veg mark (FSSAI convention: green dot or brown triangle in a square). */
export function VegMark({ veg }: { veg: boolean }) {
  return (
    <span className={`veg-mark ${veg ? "veg" : "nonveg"}`} role="img" aria-label={veg ? "Vegetarian" : "Non-vegetarian"}>
      <span />
    </span>
  );
}

const ICONS: Record<string, ReactNode> = {
  "Hot Coffee": <path d="M14 22h26v10a13 13 0 0 1-26 0zM40 25h3a5 5 0 0 1 0 10h-4M22 10c-2 3 2 5 0 8M28 8c-2 3 2 5 0 8M34 10c-2 3 2 5 0 8" />,
  "Cold Coffee": <path d="M17 14h22l-3 30H20zM15 14h26M24 6l6 8M21 24h14M23 32h10" />,
  "Tea & More": <path d="M12 24h28v4a14 14 0 0 1-28 0zM40 26h4a4 4 0 0 1 0 8h-6M18 16h16M26 10v6" />,
  Bakes: <path d="M8 34c4-14 14-20 18-20s14 6 18 20c-6 4-30 4-36 0zM18 22l4 12M26 18v16M34 22l-4 12" />,
  "Quick Bites": <path d="M8 30h36l-4 8H12zM10 30c0-10 8-16 16-16s16 6 16 16M18 24h4M26 22h4M34 24h-2" />,
};

export function ItemArt({ category, name }: { category: string; name: string }) {
  return (
    <div className="item-art" aria-hidden="true">
      <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[category] ?? <circle cx="26" cy="26" r="14" />}
      </svg>
      <span className="item-art-initial">{name.charAt(0)}</span>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner-cup" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 20, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Decrease">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase">
        +
      </button>
    </div>
  );
}
