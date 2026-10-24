import * as React from "react";
import { cx } from "./cx";
import { Guilloche } from "./Guilloche";

export interface EndorsementProps {
  kind: "held" | "void" | "paid" | "confirmed";
  meta?: string;
  animate?: boolean;
  children?: React.ReactNode;
}

const END: Record<EndorsementProps["kind"], string> = {
  held: "Payment held",
  void: "Void",
  paid: "Paid",
  confirmed: "Confirmed by call",
};

export function Endorsement(p: EndorsementProps): React.ReactElement {
  const k = END[p.kind] ? p.kind : "held";
  return (
    <div
      className={cx("cb-endorse", "cb-endorse-" + (k === "void" ? "held" : k), p.animate !== false && "cb-endorse-in")}
      role="img"
      aria-label={END[k] + (p.meta ? ", " + p.meta : "")}
    >
      <Guilloche size={44} className="cb-endorse-seal" lobes={7} strands={5} />
      <div>
        <div className="cb-endorse-word">{p.children || END[k]}</div>
        {p.meta ? <div className="cb-endorse-meta">{p.meta}</div> : null}
      </div>
    </div>
  );
}
