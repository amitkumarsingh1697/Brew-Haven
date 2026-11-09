import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab can reach inside `root`, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert") && el.getClientRects().length > 0);
}

/**
 * Keyboard behaviour for a modal dialog: focus moves into it when it opens, Tab and Shift+Tab
 * stay inside it, Escape closes it, and focus goes back to whatever opened it when it closes.
 * Put the returned ref on the element with role="dialog".
 */
export function useDialog<T extends HTMLElement>(onClose: () => void): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    const first = focusables(dialog).find((el) => !el.matches("[aria-label='Close'], .sheet-close, .modal-close"));
    (first ?? dialog).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === head || active === dialog)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      } else if (!dialog.contains(active)) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return ref;
}
export { Receipt } from "./Receipt";
