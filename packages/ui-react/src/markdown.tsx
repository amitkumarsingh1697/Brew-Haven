import { Fragment, type ReactNode } from "react";

/** **bold** and *italic* inside a line. */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("*") && part.length > 2 ? <em key={i}>{part.slice(1, -1)}</em> : <Fragment key={i}>{part}</Fragment>,
  );
}

/**
 * Enough Markdown for the legal and help pages: headings, paragraphs, lists and tables. The first "#" is the page
 * title (h1) and its "##" sections are h2; a later "#" part (such as the data processing terms) is
 * an h2 with h3 sections, so headings never skip a level.
 */
export function renderMarkdown(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  let parts = 0;
  const heading = (level: number, text: string, key: string) => {
    if (level === 1) parts++;
    const tag = level === 1 ? (parts === 1 ? "h1" : "h2") : level === 2 ? (parts > 1 ? "h3" : "h2") : parts > 1 ? "h4" : "h3";
    const Tag = tag as "h2";
    out.push(<Tag key={key}>{inline(text)}</Tag>);
  };
  const cells = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  md.trim()
    .split(/\n\s*\n/)
    .forEach((block, b) => {
      let lines = block.split("\n");
      const h = /^(#{1,3}) (.*)$/.exec(lines[0]!);
      if (h) {
        heading(h[1]!.length, h[2]!, `h${b}`);
        lines = lines.slice(1);
        if (!lines.length) return;
      }
      if (lines.every((l) => /^- /.test(l))) {
        out.push(<ul key={b}>{lines.map((l, i) => <li key={i}>{inline(l.slice(2))}</li>)}</ul>);
      } else if (lines.every((l) => /^\d+\. /.test(l))) {
        out.push(<ol key={b}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\d+\. /, ""))}</li>)}</ol>);
      } else if (lines.every((l) => l.startsWith("|"))) {
        const [head, , ...rows] = lines;
        out.push(
          <div className="legal-table" key={b}>
            <table>
              <thead>
                <tr>{cells(head!).map((c, i) => <th key={i}>{inline(c)}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>{cells(r).map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      } else {
        out.push(<p key={b}>{inline(lines.join(" "))}</p>);
      }
    });
  return out;
}

