"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, CheckRow } from "@/components/callback";
import type { WatchedDomain } from "@/lib/data";
import { refreshTabs } from "@/lib/refresh";

interface LookalikeWatchProps {
  domain: string;
  watched: WatchedDomain[];
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Registered look-alikes of this supplier's domain, found by the nightly Apify watch. An email
 * from any of them is flagged on arrival. A young one that's set up for email is the dangerous kind. */
export function LookalikeWatch({ domain, watched }: LookalikeWatchProps): React.ReactElement {
  const scan = useAction(api.app.watch.scanNow);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleScan() {
    setError(null);
    setRunning(true);
    try {
      const { ran } = await scan({});
      if (!ran) setError("The watch runs on Apify, and APIFY_TOKEN isn't set on this deployment.");
      await refreshTabs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "hold couldn't run the watch just now.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <article className="cb-doc p-4">
      <div className="cb-doc-head -mx-4 -mt-4 mb-3">
        <span>Look-alike domains</span>
      </div>

      {watched.length > 0 ? (
        <div role="list" className="-mx-4">
          {/* Newest registration first: a days-old look-alike is the one about to be used. */}
          {[...watched].sort((a, b) => (a.registeredDaysAgo ?? Infinity) - (b.registeredDaysAgo ?? Infinity)).map((w, i) => {
            const young = w.registeredDaysAgo !== undefined && w.registeredDaysAgo < 365;
            return (
              <CheckRow
                key={w.domain}
                n={i + 1}
                result={young && w.receivesEmail ? "fail" : "warn"}
                title={w.domain}
                evidence={
                  `A look-alike of ${w.imitates} (${w.technique})` +
                  (w.registeredDaysAgo !== undefined ? `, registered ${w.registeredDaysAgo} day${w.registeredDaysAgo === 1 ? "" : "s"} ago` : "") +
                  (w.receivesEmail ? ", set up to send email." : ".") +
                  ` Watched since ${fmtDate(w.firstSeenAt)}. An email from it is flagged on arrival.`
                }
                sources={[w.runUrl]}
              />
            );
          })}
        </div>
      ) : (
        <p className="font-mono text-[13px] text-ink-muted">
          {running ? "Checking about 80 look-alikes of " : "No registered look-alikes of "}
          {domain}
          {running ? " on Apify…" : " found yet. hold checks every night."}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2.5">
        <Button variant="secondary" size="sm" disabled={running} onClick={handleScan}>
          {running ? "Scanning…" : "Scan now"}
        </Button>
      </div>
      {error ? <p className="mt-2 font-mono text-[12px] text-hold-solid">{error}</p> : null}
    </article>
  );
}