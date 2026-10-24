"use client";
import * as React from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Button } from "@/components/callback";
import { TryAScam } from "@/components/TryAScam";

// convex/app/practice.ts isn't in the regenerated `api` object yet, so its
// functions are addressed by name.
interface PracticeScam {
  key: string;
  billKey: string;
  kind: string;
  description: string;
  checksThatShouldFire: string[];
  from: string;
  caughtLastRun: boolean | null;
  lastRunAt: string | null;
}

const listRef = makeFunctionReference<"query", Record<string, never>, PracticeScam[]>("app/practice:list");
const runSetRef = makeFunctionReference<"action", Record<string, never>, { ran: number; caught: number; missed: number }>(
  "app/practice:runSet",
);
const generateSetRef = makeFunctionReference<"action", Record<string, never>, { inserted: number }>("app/practice:generateSet");

function shortDate(iso: string | null): string {
  if (!iso) return "Never run";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function PracticePage(): React.ReactElement {
  const scams = useQuery(listRef, {});
  const runSet = useAction(runSetRef);
  const generateSet = useAction(generateSetRef);
  const [running, setRunning] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const caught = (scams ?? []).filter((s) => s.caughtLastRun === true).length;
  const missed = (scams ?? []).filter((s) => s.caughtLastRun === false).length;
  const notRun = (scams ?? []).filter((s) => s.caughtLastRun === null).length;

  async function onRun() {
    setError(null);
    setRunning(true);
    try {
      await runSet({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function onGenerate() {
    setError(null);
    setGenerating(true);
    try {
      await generateSet({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate a new set.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="cb-display text-ink">Practice</h1>
          <p className="font-mono text-[12px] text-ink-muted">
            {scams === undefined
              ? "Loading…"
              : `${caught} caught \u00b7 ${missed} missed \u00b7 ${notRun} not run \u00b7 ${scams.length} scams`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onGenerate} disabled={generating}>
            {generating ? "Writing\u2026" : "Generate new set"}
          </Button>
          <Button variant="primary" onClick={onRun} disabled={running}>
            {running ? "Running\u2026" : "Run set"}
          </Button>
          <TryAScam />
        </div>
      </div>

      {error ? <p className="text-[13px] text-hold-solid">{error}</p> : null}

      <div className="cb-ledger">
        <div className="grid grid-cols-[1fr_1fr_140px_160px] items-center gap-3 border-b-[1.5px] border-ink px-4 py-2 font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
          <span>Kind</span>
          <span>From</span>
          <span>Last run</span>
          <span>Result</span>
        </div>
        {scams === undefined ? (
          <div className="p-6 text-[13px] text-ink-muted">Loading\u2026</div>
        ) : scams.length === 0 ? (
          <div className="p-6 text-[13px] text-ink-muted">No scams yet. Generate a set to get started.</div>
        ) : (
          scams.map((s) => (
            <Link
              key={s.key}
              href={`/bills/${s.billKey}`}
              className="grid grid-cols-[1fr_1fr_140px_160px] items-center gap-3 border-t border-line px-4 py-2.5 text-ink no-underline hover:bg-surface-hover"
            >
              <span className="truncate text-[13px]">{s.kind}</span>
              <span className="truncate font-mono text-[12px] text-ink-muted">{s.from}</span>
              <span className="font-mono text-[12px] text-ink-muted">{shortDate(s.lastRunAt)}</span>
              <span className="font-mono text-[12px] uppercase tracking-wide">
                {s.caughtLastRun === null ? "Not run" : s.caughtLastRun ? "Caught" : "Missed"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
