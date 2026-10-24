import * as React from "react";
import { cx } from "./cx";

export interface LogEntryProps {
  actor: string;
  agent?: boolean;
  time: string;
  why?: string;
  children: React.ReactNode;
}

export function LogEntry(p: LogEntryProps): React.ReactElement {
  const agent = p.agent || p.actor === "Callback";
  const initials = String(p.actor || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
  return (
    <div className={cx("cb-log", agent ? "cb-log-agent" : "cb-log-person")} role="listitem">
      <span className="cb-log-time">{p.time}</span>
      <span className={cx("cb-who", agent ? "cb-who-agent" : "cb-who-person")} title={p.actor}>
        {agent ? "CB" : initials}
      </span>
      <div>
        <span className="cb-log-what">
          <b>{p.actor}</b> {p.children}
        </span>
        {p.why ? <span className="cb-log-why">{agent ? p.why : "\u201c" + p.why + "\u201d"}</span> : null}
      </div>
    </div>
  );
}
