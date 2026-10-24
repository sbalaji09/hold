"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, SignOff, Endorsement, Cite } from "@/components/callback";
import type { Approval } from "@/lib/types";

interface ThreadMsg {
  from: "dev" | "callback";
  text: string;
  at: string;
  cite?: string;
}

type Decision = "approved" | "approved-safe" | "rejected" | null;

function defaultRuleText(approval: Approval, decision: Decision): string {
  const bill = approval.bill;
  const acct = bill.bankAccount;
  if (approval.kind === "bank_change") {
    return `Bank changes need a passed call plus Dev; verified account ${acct.bank} \u00b7\u00b7${acct.last4}.`;
  }
  return decision === "rejected"
    ? `Hold bills like invoice ${bill.invoiceNo} from ${bill.supplier.name} for Dev's review.`
    : `Pay bills like invoice ${bill.invoiceNo} from ${bill.supplier.name} without asking Dev again.`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Dev's sign-off, reply thread and pushback for one approval. */
export function PushbackThread({ approval, actor }: { approval: Approval; actor: "maya" | "dev" }): React.ReactElement {
  const router = useRouter();
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const reply = useAction(api.app.pushback.reply);
  const decideApproval = useMutation(api.app.mutations.decideApproval);
  const bill = approval.bill;
  const acct = bill.bankAccount;
  const [decision, setDecision] = React.useState<Decision>(null);
  const [thread, setThread] = React.useState<ThreadMsg[]>(
    approval.thread.map((m) => ({ from: m.from === "dev" ? "dev" : "callback", text: m.text, at: m.at })),
  );
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState<"reply" | "approve" | "approve-safe" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [safeAlternative, setSafeAlternative] = React.useState<{ bankAccountKey: string } | null>(null);
  const saveRule = useMutation(api.app.rules.saveRule);
  const [ruleText, setRuleText] = React.useState(() => defaultRuleText(approval, null));
  const [ruleState, setRuleState] = React.useState<"idle" | "saving" | "saved">("idle");
  const [ruleError, setRuleError] = React.useState<string | null>(null);

  const lastFromCallback = thread.length > 0 && thread[thread.length - 1].from === "callback";

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!convexConfigured) {
      setError("Convex isn't connected. This action needs the backend.");
      return;
    }
    setError(null);
    setPending("reply");
    try {
      const result = await reply({ billKey: bill.key, text });
      const now = new Date().toISOString();
      const cite = result.clip ? `Call \u00b7 ${result.clip.start_s}s-${result.clip.end_s}s` : undefined;
      setThread((t) => [...t, { from: "dev", text, at: now }, { from: "callback", text: result.text, at: new Date().toISOString(), cite }]);
      setSafeAlternative(result.safeAlternative);
      setDraft("");
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : err instanceof Error ? err.message : "Callback couldn't reply just now.");
    } finally {
      setPending(null);
    }
  }

  async function decide(kind: "approve" | "approve-safe" | "reject", payToBankAccountKey?: string) {
    if (!convexConfigured) {
      setError("Convex isn't connected. This action needs the backend.");
      return;
    }
    setError(null);
    setPending(kind);
    try {
      const res = await decideApproval({
        billKey: bill.key,
        decision: kind === "reject" ? "reject" : "approve",
        actor,
        payToBankAccountKey,
      });
      if (res && typeof res === "object" && "refused" in res) {
        setError(res.refused);
        router.refresh();
        return;
      }
      const next = kind === "reject" ? "rejected" : kind === "approve-safe" ? "approved-safe" : "approved";
      setDecision(next);
      setRuleText(defaultRuleText(approval, next));
      router.refresh();
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : err instanceof Error ? err.message : "Callback couldn't record that decision.");
    } finally {
      setPending(null);
    }
  }

  async function saveAsRule() {
    const text = ruleText.trim();
    if (!text) return;
    if (!convexConfigured) {
      setRuleError("Convex isn't connected. This action needs the backend.");
      return;
    }
    setRuleError(null);
    setRuleState("saving");
    try {
      await saveRule({
        supplierKey: bill.supplier.key,
        text,
        actor,
        sourceKind: "approval",
        sourceKey: approval.key,
      });
      setRuleState("saved");
    } catch (err) {
      setRuleState("idle");
      setRuleError(err instanceof ConvexError && typeof err.data === "string" ? err.data : err instanceof Error ? err.message : "Couldn't save that rule.");
    }
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

      {decision === null && lastFromCallback && safeAlternative ? (
        <Button variant="primary" size="sm" disabled={pending !== null} onClick={() => decide("approve-safe", safeAlternative.bankAccountKey)}>
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
            <Button variant="secondary" size="sm" type="submit" disabled={pending !== null}>
              {pending === "reply" ? "Sending…" : "Send"}
            </Button>
            <Button variant="primary" size="sm" disabled={pending !== null} onClick={() => decide("approve")}>
              Approve
            </Button>
            <Button variant="secondary" size="sm" disabled={pending !== null} onClick={() => decide("reject")}>
              Reject
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <p className="font-mono text-[12px] text-hold-solid">{error}</p> : null}

      {decision !== null ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <label htmlFor={`rule-${approval.key}`} className="cb-caps">
            Save as a rule for this supplier
          </label>
          {ruleState === "saved" ? (
            <p className="font-mono text-[13px] text-ink">Saved. Callback will cite this rule on {bill.supplier.name}'s later bills.</p>
          ) : (
            <>
              <textarea
                id={`rule-${approval.key}`}
                rows={2}
                value={ruleText}
                onChange={(e) => setRuleText(e.target.value)}
                className="resize-none rounded-sm border border-line-control bg-surface p-2 text-[13px] text-ink"
              />
              <div>
                <Button variant="secondary" size="sm" disabled={ruleState === "saving"} onClick={saveAsRule}>
                  {ruleState === "saving" ? "Saving…" : "Save rule"}
                </Button>
              </div>
              {ruleError ? <p className="font-mono text-[12px] text-hold-solid">{ruleError}</p> : null}
            </>
          )}
        </div>
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
