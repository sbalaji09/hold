"use client";
import * as React from "react";
import { useAction } from "convex/react";
import { makeFunctionReference } from "convex/server";
import Link from "next/link";
import { Button } from "@/components/callback";

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

export function TryAScam(): React.ReactElement {
  const ingest = useAction(ingestEmailRef);
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
    return <Button onClick={() => setOpen(true)}>Try a scam</Button>;
  }

  return (
    <form onSubmit={onSubmit} className="cb-doc flex flex-col gap-3 p-4">
      <div className="cb-doc-head">
        <span>Try a scam</span>
        <small>Lands in the real inbox</small>
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
              Sent. It isn&rsquo;t a bill: hold {result.status === "Filed" ? "filed it on the supplier record" : "sent it to Maya as a message"}.{" "}
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
