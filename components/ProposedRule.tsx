"use client";
// Bill page: the rule hold proposed from this bill's check call (convex/app/callOutcome.ts's
// applyCallResult), waiting for you to keep or dismiss it. Hidden when there's none.
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, Cite } from "@/components/callback";
import { errorText } from "@/components/Playbook";

export function ProposedRule({ billKey, supplierKey, supplierName }: { billKey: string; supplierKey: string; supplierName: string }): React.ReactElement | null {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const proposed = useQuery(api.app.rules.proposedForBill, convexConfigured ? { billKey } : "skip");
  const keep = useMutation(api.app.rules.keepRule);
  const dismiss = useMutation(api.app.rules.dismissRule);
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState<"keep" | "dismiss" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [kept, setKept] = React.useState(false);

  React.useEffect(() => {
    if (proposed) setText(proposed.text);
  }, [proposed?.key]);

  if (!proposed) return null;

  async function go(action: "keep" | "dismiss") {
    setError(null);
    setPending(action);
    try {
      if (action === "keep") {
        await keep({ key: proposed!.key, actor: "dev", text });
        setKept(true);
      } else {
        await dismiss({ key: proposed!.key, actor: "dev" });
      }
    } catch (err) {
      setError(errorText(err, "Couldn't do that just now. Try again."));
    } finally {
      setPending(null);
    }
  }

  if (kept) {
    return (
      <section className="cb-doc p-4">
        <p className="m-0 font-mono text-[13px]/[20px] text-ink">
          Kept. hold uses it on{" "}
          <Cite href={`/suppliers/${encodeURIComponent(supplierKey)}`}>{supplierName}</Cite>&rsquo;s next bills.
        </p>
      </section>
    );
  }

  return (
    <section className="cb-doc p-4">
      <div className="cb-caps text-ink-muted">hold learned from this call</div>
      <textarea
        className="mt-2 w-full resize-none rounded-md border border-line bg-surface p-2 font-mono text-[13px]/[20px] text-ink outline-none focus:border-ink"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error ? <p className="mt-2 font-mono text-[12px] text-hold-solid">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={() => go("dismiss")} disabled={pending !== null}>
          {pending === "dismiss" ? "Dismissing…" : "Dismiss"}
        </Button>
        <Button size="sm" variant="primary" onClick={() => go("keep")} disabled={pending !== null}>
          {pending === "keep" ? "Keeping…" : "Keep rule"}
        </Button>
      </div>
    </section>
  );
}
