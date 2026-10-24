import * as React from "react";
import { cx } from "./cx";
import { Cite } from "./Cite";

export interface TranscriptLineProps {
  speaker: "callback" | "supplier" | "caller";
  name?: string;
  time: string;
  cite?: string;
  /** Link for the cite, when the record has a page. Extension over the design bundle. */
  citeHref?: string;
  aside?: string;
  speaking?: boolean;
  children: React.ReactNode;
}

export function TranscriptLine(p: TranscriptLineProps): React.ReactElement {
  const cb = p.speaker === "callback";
  return (
    <div className={cx("cb-script", cb ? "cb-script-callback" : "cb-script-other")}>
      <div className="cb-margin">
        <span className="cb-tc">{p.time}</span>
        {p.cite ? <Cite href={p.citeHref}>{p.cite}</Cite> : null}
      </div>
      <div>
        <div className="cb-cue">
          {p.name || (cb ? "Callback" : "Supplier")}
          {!cb && p.speaking ? <span className="cb-ind" /> : null}
        </div>
        <div className="cb-dialogue">
          {p.children}
          {cb && p.speaking ? <span className="cb-caret" aria-hidden="true" /> : null}
        </div>
        {p.aside ? <div className="cb-aside">{p.aside}</div> : null}
      </div>
    </div>
  );
}
