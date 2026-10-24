import * as React from "react";
import Link from "next/link";
import { InboxRow } from "@/components/callback";
import { listApprovals, listBills } from "@/lib/data";
import type { DataBillStatus } from "@/lib/types";
import { INBOX_FILTERS, STATUS_TO_MARK, UNSETTLED_STATUS, emailPreview, shortDate } from "@/lib/inbox";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<React.ReactElement> {
  const { status } = await searchParams;
  const activeStatus = status as DataBillStatus | undefined;
  const [bills, approvals] = await Promise.all([listBills(), listApprovals()]);
  const routed = new Map(approvals.map((a) => [a.bill.key, a.routedTo]));
  const rows = activeStatus ? bills.filter((b) => b.status === activeStatus) : bills;

  return (
    <div>
      <header className="pt-head">
        <div className="pt-head-text">
          <h1 className="cb-display">Inbox</h1>
          <p className="pt-sub">bills@fogline.fm · newest first</p>
        </div>
        <div className="pt-actions">
          <Link href="/practice" className="cb-btn cb-btn-secondary">Try a scam</Link>
        </div>
      </header>

      <nav className="pt-filters" aria-label="Filter by status">
        {INBOX_FILTERS.map((f) => {
          const href = f.status ? `/?status=${encodeURIComponent(f.status)}` : "/";
          const on = activeStatus === f.status;
          const count = f.status ? bills.filter((b) => b.status === f.status).length : bills.length;
          return (
            <Link key={f.label} href={href} aria-current={on ? "true" : undefined} className={"pt-filter" + (on ? " on" : "")}>
              {f.label}
              <span className="pt-count">{count}</span>
            </Link>
          );
        })}
      </nav>

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
          <div className="pt-empty">Nothing here. hold has no bills in this state.</div>
        ) : (
          rows.map((bill) => (
            <InboxRow
              key={bill.key}
              href={`/bills/${bill.key}`}
              from={bill.supplier.name}
              subject={bill.email.subject}
              preview={(routed.has(bill.key) ? `Routed to ${routed.get(bill.key) === "dev" ? "Dev" : "Maya"}. ` : "") + emailPreview(bill.email.body)}
              cents={bill.amountCents}
              status={STATUS_TO_MARK[bill.status]}
              unread={UNSETTLED_STATUS[bill.status]}
              time={shortDate(bill.receivedAt)}
            />
          ))
        )}
      </div></div>
    </div>
  );
}
