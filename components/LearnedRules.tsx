"use client";
// Rules you saved for a supplier, or hold proposed after a call (plan-agent.md addendum §1),
// each cited back to the record it came from. Proposed rules get Keep/Dismiss inline.
import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, Cite } from "@/components/callback";
import { errorText } from "@/components/Playbook";

function sourceLabel(sourceKind: string, sourceKey: string): string {
  switch (sourceKind) {
    case "bill":
      return `Invoice ${sourceKey}`;
    case "approval":
      return `Approval ${sourceKey}`;
    case "call":
      return `Call ${sourceKey}`;
    default:
      return sourceKey;
  }
}

function sourceHref(sourceKind: string, sourceKey: string): string | undefined {
  if (sourceKind === "bill") return `/bills/${encodeURIComponent(sourceKey)}`;
  return undefined;
}

export function LearnedRules({ supplierKey }: { supplierKey: string }): React.ReactElement | null {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const rules = useQuery(api.app.rules.listRules, convexConfigured ? { supplierKey } : "skip");
  const keep = useMutation(api.app.rules.keepRule);
  const dismiss = useMutation(api.app.rules.dismissRule);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!rules || rules.length === 0) return null;

  async function go(key: string, action: "keep" | "dismiss") {
    setError(null);
    setPending(key);
    try {
      if (action === "keep") await keep({ key, actor: "dev" });
      else await dismiss({ key, actor: "dev" });
    } catch (err) {
      setError(errorText(err, "Couldn't do that just now. Try again."));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="cb-doc">
      <div className="cb-doc-head">
        <span>Learned rules</span>
        <small>{rules.length}</small>
      </div>
      <div className="flex flex-col">
        {rules.map((rule) => (
          <div key={rule.key} className="border-t border-line px-4 py-3 first:border-0">
            <p className="font-mono text-[13px] leading-5 text-ink">{rule.text}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-muted">
              <span>{rule.status === "proposed" ? "hold" : "You"}</span>
              <Cite href={sourceHref(rule.sourceKind, rule.sourceKey)}>
                {rule.sourceKind === "call"
                  ? `From the call on ${new Date(rule.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : sourceLabel(rule.sourceKind, rule.sourceKey)}
              </Cite>
            </div>
            {rule.status === "proposed" ? (
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" onClick={() => go(rule.key, "dismiss")} disabled={pending !== null}>
                  Dismiss
                </Button>
                <Button size="sm" variant="primary" onClick={() => go(rule.key, "keep")} disabled={pending !== null}>
                  Keep rule
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {error ? <p className="px-4 pb-3 font-mono text-[12px] text-hold-solid">{error}</p> : null}
    </section>
  );
}
