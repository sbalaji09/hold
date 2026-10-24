import type { ReactNode } from "react";
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
  children: ReactNode;
}

/** Port of design/callback TranscriptLine: one turn of a call. Timecode and source sit in the margin. */
export function TranscriptLine({ speaker, name, time, cite, citeHref, aside, speaking, children }: TranscriptLineProps) {
  const cb = speaker === "callback";
  return (
    <div className={`cb-script ${cb ? "cb-script-callback" : "cb-script-other"}`}>
      <div className="cb-margin">
        <span className="cb-tc">{time}</span>
        {cite ? <Cite href={citeHref}>{cite}</Cite> : null}
      </div>
      <div>
        <div className="cb-cue">
          {name || (cb ? "Callback" : "Supplier")}
          {!cb && speaking ? <span className="cb-ind" /> : null}
        </div>
        <div className="cb-dialogue">
          {children}
          {cb && speaking ? <span className="cb-caret" aria-hidden="true" /> : null}
        </div>
        {aside ? <div className="cb-aside">{aside}</div> : null}
      </div>
    </div>
  );
}
