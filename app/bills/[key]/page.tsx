import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Amount,
  AccountLine,
  CheckRow,
  Cite,
  Endorsement,
  Line,
  LogEntry,
  SignOff,
} from "@/components/callback";
import { BillActions } from "@/components/BillActions";
import { getBill, listActivity } from "@/lib/data";
import { canCall, canHold, canPay } from "@/lib/policy";
import { CALL_LINE_STATE, CHECK_RESULT, citeLabel, whyChecks, whyText } from "@/lib/bill";

function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export default async function BillPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<React.ReactElement> {
  const { key } = await params;
  const bill = await getBill(key);
  if (!bill) notFound();

  const activity = await listActivity();
  const timeline = activity
    .filter((e) => e.refKind === "bill" && e.refKey === bill.key)
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const bankFlagged = bill.checks.find((c) => c.id === "bank-account")?.state === "flag";
  const failCount = bill.checks.filter((c) => c.state === "flag").length;
  const pay = canPay(bill);
  const hold = canHold(bill);
  const call = canCall(bill);

  const needsSignOff = bill.status === "Held" || bill.status === "Needs you";
  const bodyParagraphs = bill.email.body.split(/\n+/).filter((l) => l.trim().length > 0);
  const amount = "$" + (bill.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="grid gap-5 p-6" style={{ gridTemplateColumns: "1fr var(--evidence-width)" }}>
      <div className="col-span-2 flex items-end justify-between gap-4">
        <div>
          <div className="font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
            <Link href="/">Inbox</Link> / {bill.supplier.name} / INV-{bill.invoiceNo}
          </div>
          <h1 className="font-serif text-[24px]/[30px] text-ink">{bill.email.subject}</h1>
        </div>
        <div className="flex items-start gap-2.5">
          <details className="relative">
            <summary className="cb-ask cursor-pointer list-none">Why?</summary>
            <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-md bg-surface p-4 shadow-pop">
              <div className="cb-caps">Why?</div>
              <p className="mt-2 font-mono text-[13px]/[20px] text-ink">{whyText(bill)}</p>
              {whyChecks(bill).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {whyChecks(bill).map((c) => (
                    <Cite key={c.id}>{citeLabel(c.cite, bill)}</Cite>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
          <BillActions billKey={bill.key} amount={amount} pay={pay} hold={hold} call={call} />
        </div>
      </div>

      <article className="cb-doc relative p-5">
        <div className="grid grid-cols-[64px_1fr] gap-y-0.5 border-b border-dashed border-line pb-3 font-mono text-[12px]/[18px] text-ink-muted">
          <span>From</span>
          <b className="font-normal text-ink">
            {bill.email.fromAddress}
          </b>
          <span>To</span>
          <b className="font-normal text-ink">bills@fogline.fm</b>
          <span>Received</span>
          <b className="font-normal text-ink">{formatDateTime(bill.receivedAt)}</b>
        </div>
        <div className="max-w-[46ch] py-4 font-sans text-[14px]/[22px] text-ink">
          {bodyParagraphs.map((p, i) => (
            <p key={i} className="mb-2.5 last:mb-0">
              {p}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-2.5 border-t border-dashed border-line pt-4">
          <div className="cb-caps">Pay to</div>
          <Amount cents={bill.amountCents} size="lg" />
          <AccountLine
            bank={bill.bankAccount.bank}
            routing={"\u00b7\u00b7" + bill.bankAccount.routingLast4}
            last4={bill.bankAccount.last4}
            state={bankFlagged ? "new" : "verified"}
            note={bill.bankAccount.verifiedBy === "call+dev" ? "Verified by call, Dev approved" : "Verified at onboarding"}
          />
        </div>
        {bill.status === "Held" ? (
          <div className="absolute bottom-5 right-5">
            <Endorsement kind="held" meta={`${formatDateTime(bill.call?.startedAt ?? bill.receivedAt)} · Callback`} />
          </div>
        ) : bill.status === "Paid" && bill.payment ? (
          <div className="absolute bottom-5 right-5">
            <Endorsement
              kind="paid"
              meta={`${bill.payment.transferId ?? ""} · ${bill.bankAccount.bank} \u00b7\u00b7${bill.bankAccount.last4}`}
            />
          </div>
        ) : null}
      </article>

      <aside className="flex flex-col gap-4">
        <section className="cb-doc">
          <div className="cb-doc-head">
            Callback&rsquo;s checks
            <small>{bill.status === "Checking" ? "Running" : failCount ? `${failCount} failed` : "All passed"}</small>
          </div>
          <div role="list">
            {bill.checks.map((c, i) => (
              <CheckRow
                key={c.id}
                n={i + 1}
                result={CHECK_RESULT[c.state]}
                title={c.label}
                evidence={c.evidence}
                quote={c.quote}
                sources={[citeLabel(c.cite, bill)]}
              />
            ))}
          </div>
        </section>

        {bill.call ? (
          <Line
            state={CALL_LINE_STATE[bill.call.outcome]}
            supplier={`${bill.supplier.contactName} \u00b7 ${bill.supplier.name}`}
            number={formatPhone(bill.supplier.trustedPhone)}
            note={bill.call.transcript.find((t) => t.speaker === "supplier")?.text}
          />
        ) : failCount > 0 ? (
          <div className="cb-doc p-4 font-sans text-[13px]/[20px] text-ink-muted">
            Callback hasn&rsquo;t called {bill.supplier.name} yet.
          </div>
        ) : null}

        {needsSignOff ? (
          <section className="cb-doc p-4">
            <SignOff state="awaiting" name="Dev Okafor" role="Controller" time={`Flagged ${formatDateTime(bill.receivedAt)}`} />
          </section>
        ) : null}

        {timeline.length > 0 ? (
          <section className="cb-doc">
            <div className="cb-doc-head">
              Timeline
              <small>{timeline.length} events</small>
            </div>
            <div role="list">
              {timeline.map((e) => (
                <LogEntry
                  key={e.key}
                  actor={e.actor === "callback" ? "Callback" : e.actor === "dev" ? "Dev Okafor" : "Maya Lin"}
                  agent={e.actor === "callback"}
                  time={formatDateTime(e.at)}
                  why={e.why}
                >
                  {e.what}
                </LogEntry>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
