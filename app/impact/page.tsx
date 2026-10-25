// Impact: what hold did for Fogline over a fixed test month (data/impact-set.json), run through
// hold's real checks (lib/impact.ts -> convex/app/checks.ts).
import * as React from "react";
import { Amount } from "@/components/callback";
import { getImpactStats } from "@/lib/impact";

export const metadata = { title: "Impact · hold" };

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="cb-caps text-ink-muted">{label}</div>
      <div className="font-serif text-[28px]/[34px] text-ink">{value}</div>
      {note ? <div className="text-[13px] text-ink-muted">{note}</div> : null}
    </div>
  );
}

export default function ImpactPage(): React.ReactElement {
  const stats = getImpactStats();
  const hours = (stats.staffMinutesSaved / 60).toFixed(1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="cb-display text-ink">Impact</h1>
        <p className="max-w-[70ch] text-[13px] text-ink-muted">How Fogline's month went with hold handling the bills: what went out, what was stopped, and what it saved the team.</p>
      </div>

      <section className="cb-doc" aria-labelledby="impact-stats-head">
        <div className="cb-doc-head">
          <span id="impact-stats-head">This month</span>
        </div>
        <div className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-3">
          <Stat label="Paid out" value={<Amount cents={stats.paidOutCents} size="lg" />} note="Bills hold cleared and paid." />
          <Stat label="Held back" value={<Amount cents={stats.moneyHeldBackCents} size="lg" />} note="Scam bills stopped before payment." />
          <Stat label="Scams stopped" value={`${stats.scamsCaught} of ${stats.scamsInSet}`} />
          <Stat label="Bills handled" value={stats.invoicesReviewed} />
          <Stat label="Bills held for a call" value={stats.phoneCallsPlaced} note={stats.falsePositives ? `${stats.falsePositives} were genuine and cleared after the call.` : undefined} />
          <Stat label="Time saved" value={`${hours} hrs`} note={`At ${stats.minutesPerManualCheck} minutes a bill by hand.`} />
        </div>
      </section>
    </div>
  );
}
