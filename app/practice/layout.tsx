import type * as React from "react";
import { listBills } from "@/lib/data";

/** Measured, not claimed: counts come from the workspace's own records. */
async function measures() {
  const bills = await listBills();
  const wronglyHeld = bills.filter((b) => !b.planted && (b.status === "Held" || b.status === "Needs you")).length;
  const spans = bills.flatMap((b) => (b.call ? [b.call.transcript.at(-1)!.ts - b.call.transcript[0].ts] : []));
  const minutes = spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length / 60 : null;
  return { wronglyHeld, minutes, calls: spans.length };
}

export default async function PracticeLayout({ children }: { children: React.ReactNode }) {
  const m = await measures();
  return (
    <>
      {children}
      <p className="pt-sub" style={{ marginTop: "var(--space-4)" }}>
        Real bills wrongly held: {m.wronglyHeld} · Minutes per check call: {m.minutes === null ? "no calls yet" : m.minutes.toFixed(1)} ({m.calls} calls)
      </p>
    </>
  );
}
