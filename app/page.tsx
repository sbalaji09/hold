import * as React from "react";
import Link from "next/link";
import { InboxRow, StatusMark } from "@/components/callback";
import { listApprovals, listBills, listMessages, type Message } from "@/lib/data";
import { INBOX_FILTERS, MESSAGE_MARK, STATUS_TO_MARK, UNSETTLED_STATUS, emailPreview, inboxItems, parseView, shortDate, type InboxView } from "@/lib/inbox";

const EMPTY: Record<string, string> = {
  messages: "No messages from suppliers. hold sorts every supplier email, and anything for Maya lands here.",
  filed: "Nothing filed yet. Emails hold files, and messages marked done, show up here.",
};

/** A supplier email that isn't a bill: same ledger row as a bill, marked Message where the amount goes. */
function MessageRow({ m }: { m: Message }): React.ReactElement {
  const t = m.triage!;
  const mark = MESSAGE_MARK[t.status];
  return (
    <Link href={`/messages/${encodeURIComponent(m.key)}`} className={"cb-ledger-row" + (t.status === "open" ? " cb-ledger-unread" : "")}>
      <span className="cb-dot" aria-label={t.status === "open" ? "Unread" : undefined} />
      <span className="cb-from">{m.supplierName}</span>
      <span className="cb-subj">
        <b>{m.subject}</b>
        {" — " + emailPreview(m.body)}
      </span>
      <span className="cb-r cb-caps">Message</span>
      <span>
        <StatusMark status={mark.status}>{mark.label}</StatusMark>
      </span>
      <span className="cb-when cb-r">{shortDate(m.receivedAt)}</span>
    </Link>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<React.ReactElement> {
  const view = parseView((await searchParams).status);
  const [bills, approvals, messages] = await Promise.all([listBills(), listApprovals(), listMessages()]);
  const routed = new Map(approvals.map((a) => [a.bill.key, a.routedTo]));
  const rows = inboxItems(bills, messages, view);
  const count = (v: InboxView | undefined) => inboxItems(bills, messages, v).length;
  const settled = messages.done.length + messages.filed.length;

  return (
    <div>
      <header className="pt-head">
        <div className="pt-head-text">
          <h1 className="cb-display">{view === "filed" ? "Done and filed" : "Inbox"}</h1>
          <p className="pt-sub">
            {view === "filed" ? "Supplier emails hold filed, and messages marked done · newest first" : "bills@fogline.fm · newest first"}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav className="pt-filters" aria-label="Filter the inbox">
          {INBOX_FILTERS.map((f) => {
            const on = view === f.view;
            return (
              <Link
                key={f.label}
                href={f.view ? `/?status=${encodeURIComponent(f.view)}` : "/"}
                aria-current={on ? "true" : undefined}
                className={"pt-filter" + (on ? " on" : "")}
              >
                {f.label}
                <span className="pt-count">{count(f.view)}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="pt-scroll"><div className="cb-ledger pt-ledger">
        <div className="cb-ledger-head">
          <span />
          <span>Supplier</span>
          <span>Subject</span>
          <span className="cb-r">Amount</span>
          <span>Status</span>
          <span className="cb-r">In</span>
        </div>
        {rows.length === 0 ? (
          <div className="pt-empty">{(view && EMPTY[view]) ?? "Nothing here. hold has no bills in this state."}</div>
        ) : (
          rows.map((row) =>
            row.kind === "message" ? (
              <MessageRow key={row.message.key} m={row.message} />
            ) : (
              <InboxRow
                key={row.bill.key}
                href={`/bills/${row.bill.key}`}
                from={row.bill.supplier.name}
                subject={row.bill.email.subject}
                preview={emailPreview(row.bill.email.body)}
                cents={row.bill.amountCents}
                status={STATUS_TO_MARK[row.bill.status]}
                unread={UNSETTLED_STATUS[row.bill.status]}
                time={shortDate(row.bill.receivedAt)}
              />
            ),
          )
        )}
      </div></div>
    </div>
  );
}
