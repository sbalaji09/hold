"use client";

import * as React from "react";
import { Button, SignOff, Endorsement, Cite } from "@/components/callback";
import { citeLabel } from "@/lib/bill";
import type { Approval } from "@/lib/types";

interface ThreadMsg {
  from: "dev" | "callback";
  text: string;
  at: string;
  cite?: string;
}

type Decision = "approved" | "approved-safe" | "rejected" | null;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Dev's sign-off, reply thread and pushback for one approval. All state is
 * local to the browser tab for now — there's no Convex mutation yet, so a
 * refresh forgets it. Swapping these setState calls for Convex mutations is
 * the only change needed once the schema lands. */
export function PushbackThread({ approval }: { approval: Approval }): React.ReactElement {
  const bill = approval.bill;
  const acct = bill.bankAccount;
  const [decision, setDecision] = React.useState<Decision>(null);
  const [thread, setThread] = React.useState<ThreadMsg[]>(
    approval.thread.map((m) => ({ from: m.from === "dev" ? "dev" : "callback", text: m.text, at: m.at })),
  );
  const [draft, setDraft] = React.useState("");

  const lastFromCallback = thread.length > 0 && thread[thread.length - 1].from === "callback";

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const flagged = bill.checks.find((c) => c.state === "flag");
    const evidence = bill.call?.summary ?? flagged?.evidence ?? "Every check on this bill has been reviewed.";
    const cite = bill.call
      ? citeLabel({ kind: "call", ref: bill.call.key }, bill)
      : flagged
        ? citeLabel(flagged.cite, bill)
        : undefined;
    const reply = `${evidence} Callback can pay the verified ${acct.bank} \u00b7\u00b7${acct.last4} account today.`;
    setThread((t) => [...t, { from: "dev", text, at: now }, { from: "callback", text: reply, at: now, cite }]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-4">
      {thread.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {thread.map((m, i) =>
            m.from === "dev" ? (
              <div key={i} className="rounded-md border border-line bg-surface p-3">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-muted">
                  <span>Dev Okafor</span>
                  <span>{fmtTime(m.at)}</span>
                </div>
                <p className="font-serif text-[15px] italic text-signatory">{"\u201c" + m.text + "\u201d"}</p>
              </div>
            ) : (
              <div key={i} className="rounded-md border border-line bg-surface-sunk p-3">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-muted">
                  <span>Callback</span>
                  <span>{fmtTime(m.at)}</span>
                </div>
                <p className="font-mono text-[13px] leading-5 text-ink">{m.text}</p>
                {m.cite ? (
                  <div className="mt-2">
                    <Cite>{m.cite}</Cite>
                  </div>
                ) : null}
              </div>
            ),
          )}
        </div>
      ) : null}

      {decision === null && lastFromCallback ? (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setDecision("approved-safe")}
        >
          {`Approve \u00b7 pay ${acct.bank} \u00b7\u00b7${acct.last4} instead`}
        </Button>
      ) : null}

      {decision === null ? (
        <form className="flex flex-col gap-2 border-t border-line pt-4" onSubmit={send}>
          <label htmlFor={`reply-${approval.key}`} className="cb-caps">
            Reply to Callback
          </label>
          <textarea
            id={`reply-${approval.key}`}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a question or push back"
            className="resize-none rounded-sm border border-line-control bg-surface p-2 text-[13px] text-ink"
          />
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" type="submit">
              Send
            </Button>
            <Button variant="primary" size="sm" onClick={() => setDecision("approved")}>
              Approve
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDecision("rejected")}>
              Reject
            </Button>
          </div>
        </form>
      ) : null}

      <div className="border-t border-line pt-4">
        {decision === "rejected" ? (
          <Endorsement kind="void" meta={`Dev Okafor \u00b7 ${fmtTime(new Date().toISOString())}`}>
            Rejected
          </Endorsement>
        ) : decision ? (
          <SignOff
            state="signed"
            name="Dev Okafor"
            role="Controller"
            time={fmtTime(new Date().toISOString())}
            verb={decision === "approved-safe" ? "Approved \u00b7 verified account" : "Approved"}
          />
        ) : (
          <SignOff state="awaiting" name="Dev Okafor" role="Your sign-off" time={`Sent ${fmtTime(bill.receivedAt)}`} />
        )}
      </div>
    </div>
  );
}
