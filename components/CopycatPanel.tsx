"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, CheckRow } from "@/components/callback";
import type { BackgroundCheck } from "@/lib/types";

const RESULT: Record<"pass" | "flag" | "info", "pass" | "fail" | "warn"> = { pass: "pass", flag: "fail", info: "warn" };

interface CopycatPanelProps {
  billKey: string;
  domain: string;
  knownDomain: string;
  lastCheck: BackgroundCheck | null;
}

/** Shown on a bill when the sender domain doesn't match the supplier's domain on file. A flag
 * here is extra information for a human reading the bill; it never changes Callback's intake
 * decision on its own (lib/policy.ts's checks are the only thing that does that). */
export function CopycatPanel({ billKey, domain, knownDomain, lastCheck }: CopycatPanelProps): React.ReactElement {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const run = useAction(api.app.background.runCopycatCheck);
  const [check, setCheck] = React.useState<BackgroundCheck | null>(lastCheck);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleRun() {
    if (!convexConfigured) {
      setError("Convex isn't connected. This check needs the backend.");
      return;
    }
    setError(null);
    setRunning(true);
    try {
      const result = await run({ billKey });
      setCheck({ key: result.key, kind: "copycat", billKey, domain, ranAt: new Date().toISOString(), findings: result.findings });
    } catch (err) {
      setError(err instanceof Error ? err.message : "hold couldn't run that check just now.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="cb-doc p-4">
      <div className="cb-doc-head -mx-4 -mt-4 mb-3">
        <span>Copycat check</span>
        {check ? <small>{new Date(check.ranAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small> : null}
      </div>
      <p className="mb-2 text-[13px] text-ink-muted">
        This bill came from <span className="font-mono text-ink">{domain}</span>, not {knownDomain} on file for this supplier.
      </p>
      {check ? (
        <div role="list" className="-mx-4">
          {check.findings.map((f, i) => (
            <CheckRow key={i} n={i + 1} result={RESULT[f.state]} title={f.label} evidence={f.evidence} sources={f.sourceUrl ? [f.sourceUrl] : undefined} />
          ))}
        </div>
      ) : null}
      <div className="mt-3">
        <Button variant="secondary" size="sm" disabled={running} onClick={handleRun}>
          {running ? "Checking…" : check ? "Run again" : "Run check"}
        </Button>
      </div>
      {error ? <p className="mt-2 font-mono text-[12px] text-hold-solid">{error}</p> : null}
    </section>
  );
}
