// Impact: a judge/team-facing screen, not a workflow screen. Runs a fixed month of Fogline
// bills (data/impact-set.json, ~60 invoices incl. 8 planted scams of varied kinds) through
// hold's real checks (lib/impact.ts -> convex/app/checks.ts) and shows what hold caught, what it
// would have cost to miss, and why a person reviewing the same inbox would likely miss it.
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
        <p className="max-w-[70ch] text-[13px] text-ink-muted">
          A fixed test month of Fogline&rsquo;s bills ({stats.invoicesReviewed} invoices, {stats.scamsInSet} of them planted scams), run through hold&rsquo;s real checks right now &mdash; the
          same engine that checks every real bill, no live Claude call, same numbers every time.
        </p>
      </div>

      <section className="cb-doc" aria-labelledby="impact-stats-head">
        <div className="cb-doc-head">
          <span id="impact-stats-head">What hold caught</span>
        </div>
        <div className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-3">
          <Stat label="Invoices reviewed" value={stats.invoicesReviewed} />
          <Stat label="Scams in the set" value={stats.scamsInSet} />
          <Stat label="Caught and held" value={`${stats.scamsCaught}/${stats.scamsInSet}`} />
          <Stat label="Money held back" value={<Amount cents={stats.moneyHeldBackCents} size="lg" />} note="What hold stopped from going out." />
          <Stat
            label="Paid out without hold"
            value={<Amount cents={stats.moneyLostWithoutHoldCents} size="lg" />}
            note="What this set would have cost if every bill were paid as emailed."
          />
          <Stat
            label="False positives"
            value={stats.falsePositives}
            note={stats.falsePositives === 0 ? "No ordinary bills wrongly held." : "Ordinary bills wrongly held — a phone call clears each one, same delay as any check call."}
          />
          <Stat label="Phone calls it would place" value={stats.phoneCallsPlaced} note="Every flagged bill, real or not." />
          <Stat
            label="Staff time saved"
            value={`${hours} hrs`}
            note={`Assumes ${stats.minutesPerManualCheck} minutes to manually check one bill — what a person would spend reading, comparing, and deciding on every invoice in this set.`}
          />
        </div>
      </section>

      <section className="cb-doc" aria-labelledby="impact-why-head">
        <div className="cb-doc-head">
          <span id="impact-why-head">Why a person misses these</span>
        </div>
        <div className="flex flex-col divide-y divide-line">
          {stats.why.map((row) => (
            <div key={row.title} className="flex flex-col gap-1 p-4">
              <div className="text-[14px] font-medium text-ink">{row.title}</div>
              <p className="max-w-[70ch] text-[13px] text-ink-muted">{row.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
