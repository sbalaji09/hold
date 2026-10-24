import * as React from "react";
import { cx } from "./cx";
import { G, TransitGlyph, OnUsGlyph } from "./glyphs";

export interface AccountLineProps {
  bank?: string;
  routing?: string;
  last4: string;
  state?: "verified" | "new";
  note?: string;
}

export function AccountLine(p: AccountLineProps): React.ReactElement {
  const st = p.state || "verified";
  return (
    <span className={cx("cb-acct", "cb-acct-" + st)}>
      <span className="cb-micr">
        {p.bank ? <span className="cb-micr-bank">{p.bank}</span> : null}
        {p.routing ? (
          <>
            <TransitGlyph />
            <span>{p.routing}</span>
            <TransitGlyph />
          </>
        ) : null}
        <span className="cb-micr-digits">{"\u00b7\u00b7" + (p.last4 || "0000")}</span>
        <OnUsGlyph />
      </span>
      <span className="cb-acct-note">
        {st === "new" ? (
          "Never paid before"
        ) : (
          <>
            {G.tick()}
            {p.note || "Verified"}
          </>
        )}
      </span>
    </span>
  );
}
