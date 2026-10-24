import * as React from "react";
import { cx } from "./cx";
import { G } from "./glyphs";

export type BillStatus = "paid" | "scheduled" | "checking" | "calling" | "held" | "needs-you";

export interface StatusMarkProps {
  status: BillStatus;
  children?: React.ReactNode;
}

const MARK: Record<BillStatus, string> = {
  paid: "Paid",
  scheduled: "Scheduled",
  checking: "Checking",
  calling: "Calling",
  held: "Held",
  "needs-you": "Needs you",
};

export function StatusMark(p: StatusMarkProps): React.ReactElement {
  const s = MARK[p.status] ? p.status : "paid";
  const glyph =
    s === "paid" ? G.tick() :
    s === "scheduled" ? G.clock() :
    s === "calling" ? <span className="cb-ind" /> :
    s === "held" ? G.hold() :
    s === "needs-you" ? G.person() :
    null;
  const label = p.children || MARK[s];
  return (
    <span className={cx("cb-mark", "cb-mark-" + s)} role="status">
      {glyph}
      {s === "checking" ? <span className="cb-dots">{label}</span> : label}
    </span>
  );
}
