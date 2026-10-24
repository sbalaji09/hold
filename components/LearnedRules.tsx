// Rules you saved for a supplier (plan-agent.md addendum §1), each cited back to the
// record it came from. Server component: listRules already returns plain data, no client state.
import * as React from "react";
import { Cite } from "@/components/callback";
import { getCompany, listRules } from "@/lib/data";

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

export async function LearnedRules({ supplierKey }: { supplierKey: string }): Promise<React.ReactElement | null> {
  const rules = await listRules(supplierKey);
  if (rules.length === 0) return null;

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
              <span>You</span>
              <Cite href={sourceHref(rule.sourceKind, rule.sourceKey)}>{sourceLabel(rule.sourceKind, rule.sourceKey)}</Cite>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
