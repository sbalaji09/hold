import type { ReactNode } from "react";
import { Cite } from "./Cite";
import { glyphs } from "./glyphs";

export interface CheckRowProps {
  n?: number;
  result: "pass" | "fail" | "warn";
  title: string;
  evidence?: ReactNode;
  quote?: string;
  flag?: string;
  sources?: string[];
}

function quoteWith(q: string, flag?: string): ReactNode {
  const i = flag ? q.indexOf(flag) : -1;
  if (!flag || i < 0) return q;
  return [q.slice(0, i), <span key="f" className="cb-flag">{flag}</span>, q.slice(i + flag.length)];
}

/** Port of design/callback CheckRow: one numbered check. The words that gave it away are marked, not scored. */
export function CheckRow({ n, result = "pass", title, evidence, quote, flag, sources }: CheckRowProps) {
  const label = result === "fail" ? "Failed" : result === "warn" ? "Look closer" : "Passed";
  return (
    <div className={`cb-check cb-check-${result}`} role="listitem">
      <span className="cb-check-n">{n != null ? String(n).padStart(2, "0") : ""}</span>
      <span className="cb-check-glyph" aria-label={label}>
        {result === "fail" ? glyphs.x() : result === "warn" ? glyphs.q() : glyphs.tick()}
      </span>
      <div className="cb-check-body">
        <div className="cb-check-title">{title}</div>
        {evidence ? <div className="cb-check-ev">{evidence}</div> : null}
        {quote && result !== "pass" ? (
          <div className="cb-quote cb-micro">
            “{quoteWith(quote, flag)}”
          </div>
        ) : null}
        {result !== "pass" && sources?.length ? (
          <div className="cb-check-src">
            {sources.map((s, i) => (
              <Cite key={i}>{s}</Cite>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
