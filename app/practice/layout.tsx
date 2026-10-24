import type * as React from "react";

import { listBills } from "@/lib/data";

/** Measured, not claimed: counts come from the workspace's own records. */
async function measures() {
  const bills = await listBills();
  const wronglyHeld = bills.filter(
    (b) => !b.planted && (b.status === "Held" || b.status === "Needs you") && b.checks.some((c) => c.id === "bank-account" && c.state === "flag"),
  ).length;
  // A call that never connected has no transcript, so it has no length to measure.
  const spans = bills.flatMap((b) => (b.call?.transcript.length ? [b.call.transcript.at(-1)!.ts - b.call.transcript[0].ts] : []));
  const minutes = spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length / 60 : null;
  return { wronglyHeld, minutes, calls: spans.length };
}

export default async function PracticeLayout({ children }: { children: React.ReactNode }) {
  const m = await measures();
  return (
    <>
      {children}
      {/* A div, so it shares the screen's centred column (shell.css .pt-main > div). */}
      <div className="px-6">
        <p className="pt-sub">
          Real bank changes wrongly held: {m.wronglyHeld} · Minutes per check call: {m.minutes === null ? "no calls yet" : m.minutes.toFixed(1)} ({m.calls} calls)
        </p>
      </div>
    </>
  );
}
