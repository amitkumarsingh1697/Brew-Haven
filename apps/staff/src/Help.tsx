import { useState } from "react";
import { createPortal } from "react-dom";
import type { StaffRole } from "@brew-haven/contracts";
import { renderMarkdown, useDialog } from "@brew-haven/ui-react";
import cashier from "../../../docs/training/cashier.md?raw";
import kitchen from "../../../docs/training/kitchen.md?raw";
import owner from "../../../docs/training/owner.md?raw";

/** The training guides from docs/training, opened from the top bar; each role sees its own first. */
const GUIDES = { CASHIER: { label: "Cashier", text: cashier }, KITCHEN: { label: "Kitchen", text: kitchen }, ADMIN: { label: "Owner", text: owner } } as const;

export function HelpButton({ role }: { role: StaffRole }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link-btn help-btn" onClick={() => setOpen(true)}>
        Help
      </button>
      {open && createPortal(<HelpModal role={role} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function HelpModal({ role, onClose }: { role: StaffRole; onClose: () => void }) {
  const [which, setWhich] = useState<keyof typeof GUIDES>(role);
  const ref = useDialog<HTMLDivElement>(onClose);
  // Outside the top bar (a portal), so it takes the page colours. The owner can read every guide, to train staff; others see their own.
  const tabs = role === "ADMIN" ? (["ADMIN", "CASHIER", "KITCHEN"] as const) : [role];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal help-modal" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          {tabs.length > 1 && (
            <div className="station-bar" role="group" aria-label="Guide">
              {tabs.map((t) => (
                <button key={t} className={t === which ? "chip chip-on" : "chip"} aria-pressed={t === which} onClick={() => setWhich(t)}>
                  {GUIDES[t].label}
                </button>
              ))}
            </div>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="help-body">{renderMarkdown(GUIDES[which].text)}</div>
      </div>
    </div>
  );
}
