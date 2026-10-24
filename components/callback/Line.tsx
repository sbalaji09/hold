import * as React from "react";
import { cx } from "./cx";

export interface LineProps {
  state: "ringing" | "connected" | "no-answer" | "dropped" | "confirmed" | "not-confirmed";
  supplier: string;
  number: string;
  source?: string;
  elapsed?: string;
  note?: string;
  label?: string;
  bars?: number[];
}

const LINE: Record<LineProps["state"], string> = {
  ringing: "Ringing",
  connected: "On the line",
  "no-answer": "No answer",
  dropped: "Line dropped",
  confirmed: "Confirmed",
  "not-confirmed": "Not confirmed",
};

const DEFAULT_BARS = [
  3, 6, 11, 16, 9, 5, 13, 20, 12, 7, 15, 9, 4, 11, 18, 8, 5, 10, 14, 7, 4, 9, 12, 6, 3, 8, 13, 17, 9, 5, 3, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
];

export function Line(p: LineProps): React.ReactElement {
  const st = LINE[p.state] ? p.state : "ringing";
  const live = st === "ringing" || st === "connected";
  const bars = p.bars || DEFAULT_BARS;
  return (
    <div className={cx("cb-line", "cb-line-" + st, live && "cb-line-live")} role="status">
      <span className="cb-lamp" aria-hidden="true" />
      <div className="cb-line-who">{p.supplier}</div>
      <div className="cb-line-right">
        <div className="cb-line-clock">{p.elapsed || "\u2013\u2013:\u2013\u2013"}</div>
        <div className="cb-line-state">{p.label || LINE[st]}</div>
      </div>
      <div className="cb-line-dial">{p.number + (p.source ? "  \u00b7  " + p.source : "")}</div>
      {p.note ? <div className="cb-line-note">{p.note}</div> : null}
      {st === "connected" ? (
        <div className="cb-wave" aria-hidden="true">
          {bars.map((b, i) => (
            <i key={i} className={b <= 2 ? "cb-quiet" : undefined} style={{ height: Math.max(2, b) + "px" }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
