"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Amount, Button } from "@/components/callback";

interface RunPaymentsProps {
  billKeys: string[];
  total: number;
  lockedReason?: string;
}

interface Result {
  billKey: string;
  transferId?: string;
  error?: string;
}

export function RunPayments({ billKeys, total, lockedReason }: RunPaymentsProps): React.ReactElement {
  const router = useRouter();
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const runPayments = useAction(api.app.increase.runPayments);
  const [pending, setPending] = React.useState(false);
  const [results, setResults] = React.useState<Result[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    if (!convexConfigured) {
      setError("Convex isn't connected. This action needs the backend.");
      return;
    }
    if (billKeys.length === 0) return;
    setPending(true);
    setError(null);
    setResults(null);
    try {
      const out = await runPayments({ billKeys });
      setResults(out);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "hold couldn't run this payment batch.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {lockedReason ? (
        <Button variant="primary" locked={lockedReason}>
          Run payments
        </Button>
      ) : (
        <Button variant="primary" onClick={run} locked={pending ? "Sending…" : undefined}>
          {"Run payments \u00b7 "}
          <Amount cents={total} />
        </Button>
      )}
      {error ? <p className="max-w-[320px] text-right font-mono text-[12px] text-hold-solid">{error}</p> : null}
      {results ? (
        <ul className="flex max-w-[320px] flex-col items-end gap-1">
          {results.map((r) => (
            <li key={r.billKey} className="text-right font-mono text-[11.5px]">
              {r.error ? (
                <span className="text-hold-solid">
                  {r.billKey}: {r.error}
                </span>
              ) : (
                <span className="text-ink-muted">
                  {r.billKey}: {r.transferId}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
