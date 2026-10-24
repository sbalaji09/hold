export type LineState = "ringing" | "connected" | "no-answer" | "dropped" | "confirmed" | "not-confirmed";

const LINE: Record<LineState, string> = {
  ringing: "Ringing",
  connected: "On the line",
  "no-answer": "No answer",
  dropped: "Line dropped",
  confirmed: "Confirmed",
  "not-confirmed": "Not confirmed",
};

const BARS = [3, 6, 11, 16, 9, 5, 13, 20, 12, 7, 15, 9, 4, 11, 18, 8, 5, 10, 14, 7, 4, 9, 12, 6, 3, 8, 13, 17, 9, 5, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];

export interface LineProps {
  state: LineState;
  supplier: string;
  number: string;
  source?: string;
  elapsed?: string;
  note?: string;
  label?: string;
  bars?: number[];
}

/** Port of design/callback Line: one phone call. The indicator is lit only while the line is open. */
export function Line({ state, supplier, number, source, elapsed, note, label, bars = BARS }: LineProps) {
  const live = state === "ringing" || state === "connected";
  return (
    <div className={["cb-line", `cb-line-${state}`, live && "cb-line-live"].filter(Boolean).join(" ")} role="status">
      <span className="cb-lamp" aria-hidden="true" />
      <div className="cb-line-who">{supplier}</div>
      <div className="cb-line-right">
        <div className="cb-line-clock">{elapsed || "––:––"}</div>
        <div className="cb-line-state">{label || LINE[state]}</div>
      </div>
      <div className="cb-line-dial">{number + (source ? "  ·  " + source : "")}</div>
      {note ? <div className="cb-line-note">{note}</div> : null}
      {state === "connected" ? (
        <div className="cb-wave" aria-hidden="true">
          {bars.map((b, i) => (
            <i key={i} className={b <= 2 ? "cb-quiet" : undefined} style={{ height: Math.max(2, b) + "px" }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
