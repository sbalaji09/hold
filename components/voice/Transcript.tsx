"use client";
import { useCompany } from "@/lib/useCompany";
import { useLayoutEffect, useRef } from "react";
import { TranscriptLine } from "@/components/callback";
import { AGENT, citeLabel, formatElapsed, type TranscriptRow } from "./format";

export type SourceHref = (source: { kind: string; ref: string; record_id?: string }) => string | undefined;

export interface TranscriptProps {
  rows: TranscriptRow[];
  /** Cue for the other party: "Rosa (Stagecraft)", "Caller". */
  otherName: string;
  /** The last line is still being spoken. */
  live: boolean;
  /** Link for a question's source record, once the app has record pages. */
  sourceHref?: SourceHref;
  /** Shown when there are no lines yet. */
  empty: string;
  /** Large type for the Live call screen (the venue is loud). */
  large?: boolean;
}

/** A call transcript in a document. Sticks to the latest line unless the reader has scrolled up. */
export function Transcript({ rows, otherName, live, sourceHref, empty, large }: TranscriptProps) {
  const { record } = useCompany();
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    // The card is a separate wrapper so the scroller's edge fade can't hide its background or shadow.
    <div className="cb-doc hv-transcript-card">
      <div
        ref={box}
        className={`hv-transcript${large ? " hv-transcript-large" : ""}`}
        role="log"
        aria-live="polite"
        aria-label="Transcript"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {rows.length === 0 ? (
          <p className="hv-empty">{empty}</p>
        ) : (
          rows.map((row, i) => (
            <TranscriptLine
              key={row.key}
              speaker={row.speaker}
              name={row.speaker === "callback" ? AGENT : otherName}
              time={formatElapsed(row.ts * 1000)}
              cite={row.source ? citeLabel(row.source, record) : undefined}
              citeHref={row.source ? sourceHref?.(row.source) : undefined}
              speaking={live && i === rows.length - 1}
            >
              {row.text}
            </TranscriptLine>
          ))
        )}
      </div>
    </div>
  );
}
