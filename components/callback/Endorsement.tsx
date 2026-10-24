import type { ReactNode } from "react";
import { Guilloche } from "./Guilloche";

const END = { held: "Payment held", void: "Void", paid: "Paid", confirmed: "Confirmed by call" } as const;

export interface EndorsementProps {
  kind: keyof typeof END;
  meta?: string;
  animate?: boolean;
  children?: ReactNode;
}

/** Port of design/callback Endorsement: the formal mark placed on a document when a decision lands. */
export function Endorsement({ kind, meta, animate, children }: EndorsementProps) {
  const cls = ["cb-endorse", `cb-endorse-${kind === "void" ? "held" : kind}`, animate !== false && "cb-endorse-in"].filter(Boolean).join(" ");
  return (
    <div className={cls} role="img" aria-label={END[kind] + (meta ? `, ${meta}` : "")}>
      <Guilloche size={44} className="cb-endorse-seal" lobes={7} strands={5} />
      <div>
        <div className="cb-endorse-word">{children ?? END[kind]}</div>
        {meta ? <div className="cb-endorse-meta">{meta}</div> : null}
      </div>
    </div>
  );
}
