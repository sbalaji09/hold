import type { ReactNode } from "react";
import { glyphs } from "./glyphs";

export type BillStatus = "paid" | "scheduled" | "checking" | "calling" | "held" | "needs-you";

const MARK: Record<BillStatus, string> = {
  paid: "Paid",
  scheduled: "Scheduled",
  checking: "Checking",
  calling: "Calling",
  held: "Held",
  "needs-you": "Needs you",
};

function glyph(status: BillStatus) {
  if (status === "paid") return glyphs.tick();
  if (status === "scheduled") return glyphs.clock();
  if (status === "calling") return <span className="cb-ind" />;
  if (status === "held") return glyphs.hold();
  if (status === "needs-you") return glyphs.person();
  return null;
}

/** Port of design/callback StatusMark: six states, glyph + word, always. */
export function StatusMark({ status, children }: { status: BillStatus; children?: ReactNode }) {
  const label = children ?? MARK[status];
  return (
    <span className={`cb-mark cb-mark-${status}`} role="status">
      {glyph(status)}
      {status === "checking" ? <span className="cb-dots">{label}</span> : label}
    </span>
  );
}
