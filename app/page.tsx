import * as React from "react";
import Link from "next/link";
import { InboxRow } from "@/components/callback";
import { listBills } from "@/lib/data";
import type { DataBillStatus } from "@/lib/types";
import { INBOX_FILTERS, STATUS_TO_MARK, UNSETTLED_STATUS, emailPreview, shortDate } from "@/lib/inbox";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<React.ReactElement> {
  const { status } = await searchParams;
  const activeStatus = status as DataBillStatus | undefined;
  const bills = await listBills();
  const rows = activeStatus ? bills.filter((b) => b.status === activeStatus) : bills;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-[30px]/[36px] text-ink">Inbox</h1>
          <p className="font-mono text-[12px] text-ink-muted">bills@fogline.fm · newest first</p>
        </div>
      </div>

      <div className="flex gap-1" role="tablist">
        {INBOX_FILTERS.map((f) => {
          const href = f.status ? `/?status=${encodeURIComponent(f.status)}` : "/";
          const on = activeStatus === f.status;
          const count = f.status ? bills.filter((b) => b.status === f.status).length : bills.length;
          return (
            <Link
              key={f.label}
              href={href}
              role="tab"
              aria-selected={on}
              className={
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] font-sans " +
                (on ? "bg-surface-sunk text-ink" : "text-ink-muted hover:bg-surface-hover")
              }
            >
              {f.label}
              <span className="rounded-xs bg-surface-sunk px-1 font-mono text-[11px] text-ink-muted">{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="cb-ledger">
        <div className="cb-ledger-head">
          <span />
          <span>Supplier</span>
          <span>Subject</span>
          <span className="cb-r">Amount</span>
          <span>Status</span>
          <span className="cb-r">In</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-6 text-[13px] text-ink-muted">Nothing here. Callback has no bills in this state.</div>
        ) : (
          rows.map((bill) => (
            <InboxRow
              key={bill.key}
              href={`/bills/${bill.key}`}
              from={bill.supplier.name}
              subject={bill.email.subject}
              preview={emailPreview(bill.email.body)}
              cents={bill.amountCents}
              status={STATUS_TO_MARK[bill.status]}
              unread={UNSETTLED_STATUS[bill.status]}
              time={shortDate(bill.receivedAt)}
            />
          ))
        )}
      </div>
    </div>
  );
}
