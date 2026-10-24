import * as React from "react";
import { cx } from "./cx";
import { Guilloche } from "./Guilloche";

export interface SignOffProps {
  state: "signed" | "awaiting" | "locked";
  name?: string;
  role?: string;
  time?: string;
  verb?: string;
  reason?: string;
}

export function SignOff(p: SignOffProps): React.ReactElement {
  const st = p.state || "signed";
  return (
    <div className={cx("cb-sign", "cb-sign-" + st)}>
      <div className="cb-sign-line">
        <span className="cb-sign-by">{st === "signed" ? p.verb || "Approved" : "Sign-off"}</span>
        {st === "signed" ? (
          <span className="cb-sign-name">{p.name}</span>
        ) : st === "awaiting" ? (
          <span className="cb-sign-ghost">{"Waiting for " + (p.name || "a person")}</span>
        ) : (
          <span className="cb-sign-ghost">{p.reason || "Callback can\u2019t approve its own requests"}</span>
        )}
      </div>
      <Guilloche size={52} className="cb-sign-seal" lobes={8} strands={6} />
      <div className="cb-sign-cap">
        <span>{p.role || (st === "locked" ? "Requires controller" : "")}</span>
        {p.time ? <span>{p.time}</span> : null}
      </div>
    </div>
  );
}
