// Today: the first screen. What is waiting on the signed-in person, then one section per part of
// the job (calls, bills in progress, payments, suppliers, what hold did). Every row opens the record
// it is about; there are no totals or charts.
import * as React from "react";
import Link from "next/link";
import { Amount, LogEntry, StatusMark } from "@/components/callback";
import { LiveNow } from "@/components/LiveNow";
import { listActivityWithLinks } from "@/lib/activity";
import { capital } from "@/lib/company";
import { getCompany, getSettings, listApprovals, listBills, listMessages, listPayments, listPlaybookApprovals, listSuppliers } from "@/lib/data";
import { STATUS_TO_MARK, shortDate } from "@/lib/inbox";
import { getPersona } from "@/lib/persona";
import { WATCH_ONLY_REASON } from "@/lib/policy";
import type { ApprovalKind, Bill } from "@/lib/types";

export const metadata = { title: "Today · hold" };

const KIND_LABEL: Record<ApprovalKind, string> = {
  big_payment: "Over the limit",
  held_payment: "Held",
  bank_change: "Bank change",
};

const SHOWN = 5;

function Section({ title, href, more, children }: { title: string; href: string; more: string; children: React.ReactNode }) {
  return (
    <section className="cb-doc" aria-label={title}>
      <div className="cb-doc-head">
        <span>{title}</span>
        <small>
          <Link href={href} className="underline underline-offset-4">
            {more}
          </Link>
        </small>
      </div>
      {children}
    </section>
  );
}

/** One thing to look at: what it is, hold's words about it, and its mark or amount. */
function Row({ href, title, line, right }: { href: string; title: string; line?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Link href={href} className="pt-dash-row">
      <span className="pt-dash-text">
        <span className="pt-dash-title">{title}</span>
        {line ? <span className="pt-dash-line">{line}</span> : null}
      </span>
      {right ? <span className="pt-dash-right">{right}</span> : null}
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="pt-dash-empty">{children}</p>;
}

function billTitle(b: Bill): string {
  // Intake writes "unknown" when it couldn't read an invoice number from the email.
  return b.invoiceNo && b.invoiceNo !== "unknown" ? `${b.supplier.name} · ${b.invoiceNo}` : b.supplier.name;
}

export default async function TodayPage(): Promise<React.ReactElement> {
  const [persona, co, bills, approvals, messages, payments, suppliers, changes, settings, activity] = await Promise.all([
    getPersona(),
    getCompany(),
    listBills(),
    listApprovals(),
    listMessages(),
    listPayments(),
    listSuppliers(),
    listPlaybookApprovals(),
    getSettings(),
    listActivityWithLinks(),
  ]);
  const me = co[persona];
  const other = co[persona === "dev" ? "maya" : "dev"];

  // ---- waiting on you ----
  const mine = approvals.filter((a) => (a.routedTo ?? "dev") === persona);
  const toConfirm = persona === "maya" ? suppliers.filter((s) => s.status === "new" && s.onboarding && !s.onboarding.confirmedBy) : [];
  const myChanges = changes.filter((c) => persona === "dev" || c.job === "triage");
  const myMessages = persona === "maya" ? messages.open : [];
  const waiting = mine.length + toConfirm.length + myChanges.length + myMessages.length;
  const waitingKeys = new Set(mine.map((a) => a.billKey));

  // ---- the rest of the job ----
  const working = bills.filter((b) => (b.status === "Checking" || b.status === "Calling" || b.status === "Held" || b.status === "Needs you") && !waitingKeys.has(b.key));
  const paidKeys = new Set(payments.filter((p) => p.status === "sent" || p.status === "pending").map((p) => p.billKey));
  const toPay = bills.filter((b) => b.status === "Scheduled" && !paidKeys.has(b.key)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const sent = payments.filter((p) => p.status === "sent").sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const review = suppliers.filter((s) => s.status === "new" || s.status === "under_review");
  const recent = [...activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, SHOWN);
  const actorName = { callback: "hold", maya: co.maya.name, dev: co.dev.name } as const;

  return (
    <div>
      <header className="pt-head">
        <div className="pt-head-text">
          <h1 className="cb-display">Today</h1>
          <p className="pt-sub">
            Signed in as {me.full}, {me.role.toLowerCase()}. {waiting === 0 ? "Nothing is waiting on you." : `${waiting} waiting on you.`}
          </p>
        </div>
      </header>

      <section className="cb-doc pt-dash-you" aria-labelledby="waiting-head">
        <div className="cb-doc-head">
          <span id="waiting-head">Waiting on you</span>
          <small>{me.full}</small>
        </div>
        {waiting === 0 ? (
          <Empty>Nothing is waiting on you. hold puts anything that needs {me.name} here, and everything else goes to {other.name} or happens on its own.</Empty>
        ) : (
          <>
            {mine.map((a) => (
              <Row
                key={a.key}
                href={persona === "dev" ? "/approvals" : `/bills/${a.billKey}`}
                title={`${KIND_LABEL[a.kind]}: ${billTitle(a.bill)}`}
                line={a.reason ?? a.recommendation}
                right={<Amount cents={a.bill.amountCents} />}
              />
            ))}
            {myChanges.map((c) => (
              <Row
                key={c.key}
                href="/approvals"
                title={`Change to how hold ${c.job === "triage" ? "sorts email" : "checks"}: ${c.name}`}
                line="It makes hold less strict, so it waits for a person before it goes live."
              />
            ))}
            {toConfirm.map((s) => (
              <Row
                key={s.key}
                href={`/suppliers/${s.key}`}
                title={`Confirm a new ${co.payee.one}: ${s.name}`}
                line="hold won't call them until a person confirms their number and what was agreed."
                right={<StatusMark status="needs-you" />}
              />
            ))}
            {myMessages.map((m) => (
              <Row
                key={m.key}
                href={`/messages/${encodeURIComponent(m.key)}`}
                title={`Message from ${m.supplierName}: ${m.subject}`}
                line={m.triage?.why}
                right={<span className="cb-when">{shortDate(m.receivedAt)}</span>}
              />
            ))}
          </>
        )}
      </section>

      <div className="pt-dash-grid">
        <Section title="On the line" href="/phone" more="Phone line">
          <LiveNow />
        </Section>

        <Section title={`${capital(co.bill).many} hold is working on`} href="/inbox" more="Inbox">
          {working.length === 0 ? (
            <Empty>No {co.bill.many} are being checked or held right now.</Empty>
          ) : (
            working
              .slice(0, SHOWN)
              .map((b) => <Row key={b.key} href={`/bills/${b.key}`} title={billTitle(b)} line={b.email.subject} right={<StatusMark status={STATUS_TO_MARK[b.status]} />} />)
          )}
        </Section>

        <Section title="Payments" href="/payments" more="Payments">
          {settings.watchOnly ? <p className="pt-dash-note">{WATCH_ONLY_REASON}</p> : null}
          {toPay.length === 0 && sent.length === 0 ? <Empty>Nothing scheduled and nothing sent yet.</Empty> : null}
          {toPay.slice(0, SHOWN).map((b) => (
            <Row key={b.key} href={`/bills/${b.key}`} title={billTitle(b)} line={`Scheduled · due ${shortDate(b.dueDate)} · to ${b.bankAccount.bank} ··${b.bankAccount.last4}`} right={<Amount cents={b.amountCents} />} />
          ))}
          {sent[0] ? (
            <Row
              href={`/bills/${sent[0].billKey}`}
              title={`Last sent: ${billTitle(sent[0].bill)}`}
              line={`${shortDate(sent[0].paidAt)}${sent[0].transferId ? ` · ${sent[0].transferId}` : ""}`}
              right={<Amount cents={sent[0].amountCents} />}
            />
          ) : null}
        </Section>

        <Section title={capital(co.payee).many} href="/suppliers" more={`All ${co.payee.many}`}>
          {review.length === 0 ? (
            <Empty>Every {co.payee.one} is trusted. New ones show here until their first confirmed call.</Empty>
          ) : (
            review.slice(0, SHOWN).map((s) => (
              <Row
                key={s.key}
                href={`/suppliers/${s.key}`}
                title={s.name}
                line={s.status === "new" ? "New: hold calls them before any bank change or large bill." : "Under review."}
                right={<span className="cb-caps">{s.status === "new" ? "New" : "Under review"}</span>}
              />
            ))
          )}
        </Section>

        <Section title="What happened last" href="/activity" more="Activity log">
          {recent.length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            recent.map((entry) => (
              <Link key={entry.key} href={entry.href} className="block hover:bg-surface-hover">
                <LogEntry actor={actorName[entry.actor]} agent={entry.actor === "callback"} time={shortDate(entry.at)}>
                  {entry.what}
                </LogEntry>
              </Link>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}
