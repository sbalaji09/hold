import * as React from "react";

export interface AmountProps {
  /** Integer cents. */
  cents: number;
  size?: "md" | "lg";
}

export function Amount(p: AmountProps): React.ReactElement {
  let c = Math.round(Number(p.cents || 0));
  const neg = c < 0;
  c = Math.abs(c);
  const s = Math.floor(c / 100).toLocaleString("en-US") + "." + String(c % 100).padStart(2, "0");
  if (p.size === "lg") {
    const fill = Math.max(2, 12 - s.length);
    return (
      <span className="cb-courtesy cb-micro" aria-label={(neg ? "minus " : "") + "$" + s}>
        <span className="cb-cur">$</span>
        <span className="cb-fill" aria-hidden="true">
          {new Array(fill + 1).join("*")}
        </span>
        {(neg ? "\u2212" : "") + s}
      </span>
    );
  }
  return <span className="cb-amount">{(neg ? "\u2212" : "") + "$" + s}</span>;
}
