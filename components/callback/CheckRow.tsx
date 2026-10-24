import * as React from "react";
import { cx } from "./cx";
import { G } from "./glyphs";
import { Cite } from "./Cite";

export interface CheckRowProps {
  n?: number;
  result: "pass" | "fail" | "warn";
  title: string;
  evidence?: React.ReactNode;
  quote?: string;
  flag?: string;
  sources?: string[];
}

function quoteWith(q: string, flag?: string): React.ReactNode {
  if (!flag || q.indexOf(flag) < 0) return q;
  const i = q.indexOf(flag);
  return (
    <>
      {q.slice(0, i)}
      <span className="cb-flag">{flag}</span>
      {q.slice(i + flag.length)}
    </>
  );
}

export function CheckRow(p: CheckRowProps): React.ReactElement {
  const r = p.result || "pass";
  return (
    <div className={cx("cb-check", "cb-check-" + r)} role="listitem">
      <span className="cb-check-n">{p.n != null ? String(p.n).padStart(2, "0") : ""}</span>
      <span className="cb-check-glyph" aria-label={r === "fail" ? "Failed" : r === "warn" ? "Look closer" : "Passed"}>
        {r === "fail" ? G.x() : r === "warn" ? G.q() : G.tick()}
      </span>
      <div className="cb-check-body">
        <div className="cb-check-title">{p.title}</div>
        {p.evidence ? <div className="cb-check-ev">{p.evidence}</div> : null}
        {p.quote && r !== "pass" ? (
          <div className="cb-quote cb-micro">
            {"\u201c"}
            {quoteWith(p.quote, p.flag)}
            {"\u201d"}
          </div>
        ) : null}
        {p.sources && p.sources.length ? (
          <div className="cb-check-src">
            {p.sources.map((s, i) => (
              <Cite key={i}>{s}</Cite>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
