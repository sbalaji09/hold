"use client";
import * as React from "react";
import { useAction } from "convex/react";
import { makeFunctionReference } from "convex/server";
import Link from "next/link";
import { Button } from "@/components/callback";
import { useCompany } from "@/lib/useCompany";
import type { CompanyKey } from "@/lib/company";

// convex/app/intake.ts's ingestEmail is a public action: { from, subject,
// body, receivedAt } -> { billKey, supplierKey, status, emailKey? }. An email triage sorts as
// a message (not a bill) comes back with billKey "" and its emailKey. Addressed by name
// (not through `api.app...`) because it isn't in the regenerated `api`
// object yet.
const ingestEmailRef = makeFunctionReference<
  "action",
  { from: string; subject: string; body: string; receivedAt: string },
  { billKey: string; supplierKey: string; status: string; emailKey?: string }
>("app/intake:ingestEmail");

const inv = () => String(5000 + Math.floor(Math.random() * 4000));
// Presets per company template. Each lands through the real intake with a fresh number.
const PRESETS: Record<CompanyKey, Array<{ label: string; from: string; subject: string; body: () => string }>> = {
  fogline: [
    { label: "Normal bill", from: "rosa@stagecraftrigging.com", subject: "Invoice", body: () => `Hi team,\n\nInvoice #${inv()} attached, rigging, $1,850.00. Let us know if you need anything else.\n\nThanks,\nRosa Quintero\nAccounts, Stagecraft Rigging Co.` },
    { label: "Bank change", from: "rosa@stagecraftrigging.com", subject: "Updated bank details", body: () => `Hi,\n\nInvoice #${inv()} attached, rigging, $5,400.00. We moved banks last week, please pay our new account: First Republic, acct ending 7743. Need this paid today.\n\nRosa` },
  ],
  bayline: [
    { label: "Normal payoff", from: "payoffs@pacifichomeloans.com", subject: "Payoff statement", body: () => `Bayline Title,\n\nPayoff statement for escrow 26-${inv()}. Total payoff $312,480.55, good through November 6. Wire to the account on file with your office.\n\nPayoff department\nPacific Home Loans` },
    { label: "Wire change", from: "marcia.delgado.home@gmail.com", subject: "Updated wire instructions for my proceeds", body: () => `Hi Lena,\n\nMy bank flagged my account, so please use these updated wire instructions for my proceeds of $612,450.18 on escrow 26-1188 instead of the Chase account. I'm at work all day so email is best. Please confirm today.\n\nMarcia Delgado` },
  ],
  harbor: [
    { label: "Normal timesheet", from: "maria.gutierrez@harborhealth.org", subject: "Timesheet", body: () => `Hi payroll,\n\nMy hours for the period: 80 regular. Net pay should be about $1,718.40 as usual.\n\nThanks,\nMaría` },
    { label: "Direct deposit change", from: "maria.gutierrez.hh@gmail.com", subject: "Cambio de depósito directo / direct deposit change", body: () => `Hola,\n\nPlease update my direct deposit to my new account at Chime before Friday's paycheck of $1,718.40. Por favor cambie mi depósito directo a mi nueva cuenta. I can't get to the portal, email me back here. Urgent.\n\nMaría Gutiérrez` },
  ],
};

export function TryAScam(): React.ReactElement {
  const ingest = useAction(ingestEmailRef);
  const co = useCompany();
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ billKey: string; emailKey?: string; status: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await ingest({ from, subject, body, receivedAt: new Date().toISOString() });
      setResult({ billKey: r.billKey, emailKey: r.emailKey, status: r.status });
      setFrom("");
      setSubject("");
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that scam.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Send a {co.bill.one}</Button>;
  }

  return (
    <form onSubmit={onSubmit} className="cb-doc flex flex-col gap-3 p-4">
      <div className="cb-doc-head">
        <span>Send a {co.bill.one}</span>
        <small>Lands in the real inbox</small>
      </div>
      <div className="flex gap-2">
        {PRESETS[co.key].map((p) => (
          <Button key={p.label} size="sm" type="button" onClick={() => { setFrom(p.from); setSubject(p.subject); setBody(p.body()); }}>
            {p.label}
          </Button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
        From
        <input
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="accounts@realsupplier.com"
          className="rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-[13px] text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
        Subject
        <input
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="rounded-sm border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
        Body
        <textarea
          required
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="rounded-sm border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink"
        />
      </label>
      {error ? <p className="text-[13px] text-hold-solid">{error}</p> : null}
      {result ? (
        <p role="status" className="text-[13px] text-ink-muted">
          {result.billKey ? (
            <>
              Sent. Landed as a bill, status {result.status}.{" "}
              <Link href={`/bills/${encodeURIComponent(result.billKey)}`} className="text-ink underline underline-offset-4">
                Open the bill
              </Link>
            </>
          ) : (
            <>
              Sent. It isn&rsquo;t a bill: hold {result.status === "Filed" ? "filed it on the supplier record" : `sent it to ${co.maya.name} as a message`}.{" "}
              {result.emailKey ? (
                <Link href={`/messages/${encodeURIComponent(result.emailKey)}`} className="text-ink underline underline-offset-4">
                  Open the message
                </Link>
              ) : null}
            </>
          )}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Button size="sm" type="button" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
