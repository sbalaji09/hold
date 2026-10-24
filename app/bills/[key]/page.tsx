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
  StatusMark,
} from "@/components/callback";
import { BillActions } from "@/components/BillActions";

import { ReportMissedScam } from "@/components/ReportMissedScam";
import { NotABill } from "@/components/NotABill";
import { getPersona } from "@/lib/persona";
import { CopycatPanel } from "@/components/CopycatPanel";
import { getBill, getCompany, getSettings, listActivity, listChecksForBill } from "@/lib/data";
import { canCall, canHold, canPay } from "@/lib/policy";
import { CALL_LINE_STATE, CHECK_RESULT, citeLabel, whyChecks, whyText } from "@/lib/bill";
import { routeEscalation } from "@/convex/app/checks";

/** Call length from the last transcript turn (ts is seconds into the call), as mm:ss. */
function elapsed(transcript: { ts: number }[]): string | undefined {
  const s = Math.round(Math.max(0, ...transcript.map((t) => t.ts)));
  return s > 0 ? `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : undefined;
}

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

  const copycatChecks = bill.email.fromDomain !== bill.supplier.domain ? await listChecksForBill(key) : [];
  const [settings, persona, co] = await Promise.all([getSettings(), getPersona(), getCompany()]);

  const activity = await listActivity();
  const timeline = activity
    .filter((e) => e.refKind === "bill" && e.refKey === bill.key)
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const bankFlagged = bill.checks.find((c) => c.id === "bank-account")?.state === "flag";
  // A new supplier's bill waits for a person to confirm who they are before hold calls anyone.
  const awaitingConfirm = bill.supplier.status === "new" && !bill.supplier.onboarding?.confirmedAt && !bill.supplier.key.startsWith("unknown:");
  const noAccount = bill.bankAccount.key === "";
  const failCount = bill.checks.filter((c) => c.state === "flag").length;
  const pay = canPay(bill, settings.watchOnly, co);
  const hold = canHold(bill);
  const call = canCall(bill);

  const needsSignOff = (bill.status === "Held" || bill.status === "Needs you") && !awaitingConfirm;
  const route = needsSignOff
    ? routeEscalation(bill.checks, bill.amountCents, { callOutcome: bill.call?.outcome ?? null, company: co })
    : null;
  const bodyParagraphs = bill.email.body.split(/\n+/).filter((l) => l.trim().length > 0);
  const amount = "$" + (bill.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="grid grid-cols-1 gap-5 min-[1101px]:grid-cols-[minmax(0,1fr)_var(--evidence-width)]">
      <div className="col-span-full flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[min(100%,360px)] flex-1 basis-0">
          <div className="font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
            <Link href="/inbox">Inbox</Link> / {bill.supplier.name}
            {bill.invoiceNo !== "unknown" ? ` / ${co.record === "invoice" ? "INV-" : "#"}${bill.invoiceNo}` : ""}
          </div>
          <h1 className="font-serif text-[24px]/[30px] text-ink">{bill.email.subject}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-start gap-2.5">
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
          {pay.allowed || hold.allowed || call.allowed ? <BillActions billKey={bill.key} amount={amount} pay={pay} hold={hold} call={call} /> : null}
          {bill.status !== "Held" ? <ReportMissedScam billKey={bill.key} actor={persona} /> : null}
          {bill.status !== "Paid" ? <NotABill billKey={bill.key} supplier={bill.supplier.name} actor={persona} /> : null}
        </div>
      </div>

      {awaitingConfirm ? (
        <section className="cb-doc col-span-full flex flex-wrap items-center justify-between gap-x-5 gap-y-3 p-4" aria-labelledby="new-supplier-head">
          <div className="flex min-w-0 flex-1 basis-[320px] flex-col items-start gap-1.5">
            <StatusMark status="needs-you">New {co.payee.one}</StatusMark>
            <h2 id="new-supplier-head" className="m-0 text-[15px]/[22px] font-semibold text-ink">
              New {co.payee.one}: confirm who they are
            </h2>
            <p className="m-0 font-mono text-[12.5px]/[19px] text-ink-muted">
              {co.name} has never paid {bill.supplier.name}. Confirm a trusted number and what {co.name} hired them for; then hold calls them about this {co.bill.one}. {co.dev.name} approves the first payment.
            </p>
          </div>
          <Link href={`/suppliers/${bill.supplier.key}`} className="cb-btn cb-btn-primary no-underline">
            Confirm {bill.supplier.name}
          </Link>
        </section>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4">
      <article className="cb-doc relative min-w-0 self-start p-5">
        <div className="grid grid-cols-[64px_1fr] gap-y-0.5 border-b border-dashed border-line pb-3 font-mono text-[12px]/[18px] text-ink-muted">
          <span>From</span>
          <b className="font-normal text-ink">
            {bill.email.fromAddress}
          </b>
          <span>To</span>
          <b className="font-normal text-ink">{co.inbox}</b>
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
          {noAccount ? (
            <p className="m-0 font-mono text-[13px]/[20px] text-ink">
              No bank account on file. {co.name} pays only an account it has verified with {bill.supplier.name}.
            </p>
          ) : (
            <AccountLine
              bank={bill.bankAccount.bank}
              last4={bill.bankAccount.last4}
              state={bankFlagged ? "new" : "verified"}
              note={bill.bankAccount.verifiedBy === "call+dev" ? `Verified by call, ${co.dev.name} approved` : "Verified at onboarding"}
            />
          )}
        </div>
        {bill.status === "Held" ? (
          <div className="absolute bottom-5 right-5">
            <Endorsement kind="held" meta={`${formatDateTime(bill.call?.startedAt ?? bill.receivedAt)} · hold`} />
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
        {bill.email.fromDomain !== bill.supplier.domain ? (
          <CopycatPanel billKey={bill.key} domain={bill.email.fromDomain} knownDomain={bill.supplier.domain} lastCheck={copycatChecks[0] ?? null} />
        ) : null}

        {bill.call ? (
          <Line
            state={CALL_LINE_STATE[bill.call.outcome]}
            supplier={`${bill.supplier.contactName} \u00b7 ${bill.supplier.name}`}
            number={formatPhone(bill.supplier.trustedPhone)}
            note={bill.call.summary}
            elapsed={elapsed(bill.call.transcript)}
          />
        ) : failCount > 0 && !awaitingConfirm ? (
          <div className="cb-doc p-4 font-sans text-[13px]/[20px] text-ink-muted">
            hold hasn&rsquo;t called {bill.supplier.name} yet.
          </div>
        ) : null}

        {needsSignOff ? (
          <section className="cb-doc p-4">
            <SignOff state="awaiting" name={co.dev.full} role={co.dev.role} time={`Flagged ${formatDateTime(bill.receivedAt)}`} />
            {route ? (
              <p className="mt-3 border-t border-dashed border-line pt-3 font-mono text-[12px] text-ink-muted">
                Routed to {co[route.routedTo].name}. {route.reason}
              </p>
            ) : null}
          </section>
        ) : null}


      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <section className="cb-doc">
          <div className="cb-doc-head">
            hold&rsquo;s checks
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
                  actor={e.actor === "callback" ? "hold" : co[e.actor].full}
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
