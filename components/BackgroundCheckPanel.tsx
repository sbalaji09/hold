"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, CheckRow, Cite } from "@/components/callback";
import type { BackgroundCheck } from "@/lib/types";
import { useCompany } from "@/lib/useCompany";

const RESULT: Record<"pass" | "flag" | "info", "pass" | "fail" | "warn"> = { pass: "pass", flag: "fail", info: "warn" };

interface BackgroundCheckPanelProps {
  supplierKey: string;
  lastCheck: BackgroundCheck | null;
  /** hold started this check on its own (a new supplier's first bill) and it hasn't landed yet. */
  autoRunning?: boolean;
  /** New-supplier confirmation: "Use as trusted number" fills the confirm form instead of being locked. */
  onUseNumber?: (phone: string) => void;
}

export function BackgroundCheckPanel({ supplierKey, lastCheck, autoRunning, onUseNumber }: BackgroundCheckPanelProps): React.ReactElement {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const co = useCompany();
  const run = useAction(api.app.background.runBackgroundCheck);
  const [ran, setRan] = React.useState<BackgroundCheck | null>(null);
  // The page re-renders with newer rows as they land; show whichever check is newest.
  const check = ran && (!lastCheck || ran.ranAt > lastCheck.ranAt) ? ran : lastCheck;
  // Where the suggested number was found, so a person can look before trusting it.
  const phoneSource = check?.findings.find((f) => f.label === "Phone number found" && f.state !== "flag")?.sourceUrl;
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
      const result = await run({ supplierKey });
      setRan({
        key: result.key,
        kind: "background",
        supplierKey,
        domain: check?.domain ?? "",
        ranAt: new Date().toISOString(),
        findings: result.findings,
        suggestedPhone: result.suggestedPhone,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Callback couldn't run that check just now.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <article className="cb-doc p-4">
      <div className="cb-doc-head -mx-4 -mt-4 mb-3">
        <span>Background check</span>
        {check ? <small>{new Date(check.ranAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small> : null}
      </div>

      {check ? (
        <div role="list" className="-mx-4">
          {check.findings.map((f, i) => (
            <CheckRow key={i} n={i + 1} result={RESULT[f.state]} title={f.label} evidence={f.evidence} sources={f.sourceUrl ? [f.sourceUrl] : undefined} />
          ))}
        </div>
      ) : autoRunning || running ? (
        <p className="font-mono text-[13px] text-ink-muted" role="status">
          Checking… hold is looking up their site, phone number and domain age. Results land here on their own.
        </p>
      ) : (
        <p className="text-[13px] text-ink-muted">No background check run.</p>
      )}

      {check?.suggestedPhone ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-line pt-3">
          <div>
            <div className="cb-caps">Suggested number</div>
            <p className="font-mono text-[14px] text-ink">{check.suggestedPhone}</p>
            {phoneSource ? (
              <div className="mt-1">
                <Cite href={phoneSource}>{phoneSource.replace(/^https?:\/\//, "")}</Cite>
              </div>
            ) : null}
          </div>
          {onUseNumber ? (
            <Button size="sm" onClick={() => onUseNumber(check.suggestedPhone!)}>
              Use as trusted number
            </Button>
          ) : (
            <Button size="sm" locked={`${co.dev.name} confirms numbers`}>
              Use as trusted number
            </Button>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2.5">
        <Button variant="secondary" size="sm" disabled={running} onClick={handleRun}>
          {running ? "Checking…" : "Run check"}
        </Button>
      </div>
      {error ? <p className="mt-2 font-mono text-[12px] text-hold-solid">{error}</p> : null}
    </article>
  );
}
