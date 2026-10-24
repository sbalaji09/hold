import * as React from "react";
import { cx } from "./cx";
import { Amount } from "./Amount";
import { StatusMark, type BillStatus } from "./StatusMark";

export interface InboxRowProps {
  from: string;
  subject: string;
  preview?: string;
  cents?: number;
  status: BillStatus;
  time: string;
  unread?: boolean;
  selected?: boolean;
  href?: string;
  onClick?: React.MouseEventHandler;
}

export function InboxRow(p: InboxRowProps): React.ReactElement {
  return (
    <a
      href={p.href || "#"}
      onClick={p.onClick}
      className={cx("cb-ledger-row", p.unread && "cb-ledger-unread", p.status === "calling" && "cb-ledger-live")}
      aria-selected={p.selected ? "true" : undefined}
    >
      <span className="cb-dot" aria-label={p.unread ? "Unread" : undefined} />
      <span className="cb-from">{p.from}</span>
      <span className="cb-subj">
        <b>{p.subject}</b>
        {p.preview ? " \u2014 " + p.preview : ""}
      </span>
      <span className="cb-r">{p.cents != null ? <Amount cents={p.cents} /> : ""}</span>
      <span>
        <StatusMark status={p.status} />
      </span>
      <span className="cb-when cb-r">{p.time}</span>
    </a>
  );
}
