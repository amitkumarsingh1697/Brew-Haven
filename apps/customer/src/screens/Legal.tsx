import { useEffect } from "react";
import { renderMarkdown } from "@brew-haven/ui-react";
import privacy from "../../../../docs/legal/privacy.md?raw";
import terms from "../../../../docs/legal/terms.md?raw";

/** The text lives in docs/legal so a lawyer's edits are a plain file change. */
const PAGES = { terms: { title: "Terms of service", text: terms }, privacy: { title: "Privacy policy", text: privacy } } as const;
const FINAL = import.meta.env.VITE_LEGAL_FINAL === "true";

export function Legal({ page }: { page: string }) {
  const p = PAGES[page as keyof typeof PAGES] ?? PAGES.terms;
  useEffect(() => {
    document.title = `${p.title} · Brew Haven`;
  }, [p.title]);
  return (
    <main className="legal">
      <nav className="legal-nav" aria-label="Legal">
        <a href="/legal/terms" aria-current={p === PAGES.terms ? "page" : undefined}>
          Terms of service
        </a>
        <a href="/legal/privacy" aria-current={p === PAGES.privacy ? "page" : undefined}>
          Privacy policy
        </a>
      </nav>
      {!FINAL && (
        <p className="legal-draft" role="note">
          Draft, under legal review. Words in [square brackets] are still to be filled in.
        </p>
      )}
      <article>{renderMarkdown(p.text)}</article>
    </main>
  );
}
