"use client";
import * as React from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/callback";
import { CallScript } from "@/components/Playbook";
import { capitalise } from "@/components/RouteCorrection";
import { ROUTE_WORDS } from "@/lib/triage";

// convex/app/practice.ts isn't in the regenerated `api` object yet, so its
// functions are addressed by name.
interface PracticeScam {
  key: string;
  billKey: string;
  kind: string;
  description: string;
  checksThatShouldFire: string[];
  checksFiredNow: string[];
  from: string;
  caughtLastRun: boolean | null;
  lastRunAt: string | null;
}

const listRef = makeFunctionReference<"query", Record<string, never>, PracticeScam[]>("app/practice:list");
interface RunResult {
  ran: number;
  caught: number;
  missed: number;
  calls: { ran: number; right: number; wrong: number };
  emails: { ran: number; right: number; wrong: number };
}

const runSetRef = makeFunctionReference<"action", Record<string, never>, RunResult>(
  "app/practice:runSet",
);
const generateSetRef = makeFunctionReference<"action", Record<string, never>, { inserted: number }>("app/practice:generateSet");

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the last Run set did, in the screen's own words. */
function runLine(r: RunResult, calls: number, emails: number): string {
  const parts = [`Ran ${plural(r.ran, "scam")}: ${r.caught} caught, ${r.missed} missed.`];
  if (r.calls.ran > 0) parts.push(`Ran ${plural(r.calls.ran, "call")}: ${r.calls.right} judged right, ${r.calls.wrong} wrong.`);
  else if (calls > 0) parts.push("The phone calls didn't run. hold couldn't reach Claude; try again in a minute.");
  if (r.emails.ran > 0) parts.push(`Sorted ${plural(r.emails.ran, "email")}: ${r.emails.right} right, ${r.emails.wrong} wrong.`);
  else if (emails > 0) parts.push("The practice emails didn't run. hold couldn't reach Claude; try again in a minute.");
  return parts.join(" ");
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "Never run";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function PracticePage(): React.ReactElement {
  const scams = useQuery(listRef, {});
  const lists = useQuery(api.app.techniques.list, {});
  const calls = lists?.practiceCalls;
  const emails = lists?.practiceEmails;
  const [result, setResult] = React.useState<RunResult | null>(null);
  const runSet = useAction(runSetRef);
  const generateSet = useAction(generateSetRef);
  const [running, setRunning] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const caught = (scams ?? []).filter((s) => s.caughtLastRun === true).length;
  const missed = (scams ?? []).filter((s) => s.caughtLastRun === false).length;
  const notRun = (scams ?? []).filter((s) => s.caughtLastRun === null).length;
  const right = (calls ?? []).filter((c) => c.caughtLastRun === true).length;
  const wrong = (calls ?? []).filter((c) => c.caughtLastRun === false).length;
  const callsNotRun = (calls ?? []).length - right - wrong;
  const sortedRight = (emails ?? []).filter((e) => e.caughtLastRun === true).length;
  const sortedWrong = (emails ?? []).filter((e) => e.caughtLastRun === false).length;
  const emailsNotRun = (emails ?? []).length - sortedRight - sortedWrong;

  async function onRun() {
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      setResult(await runSet({}));
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="cb-display text-ink">Practice</h1>
          <p className="font-mono text-[12px] text-ink-muted">
            {scams === undefined
              ? "Loading…"
              : `${caught} caught \u00b7 ${missed} missed \u00b7 ${notRun} not run \u00b7 ${plural(scams.length, "scam")}`}
          </p>
          <p className="font-mono text-[12px] text-ink-muted">
            {calls === undefined
              ? "Loading…"
              : `${right} right \u00b7 ${wrong} wrong \u00b7 ${callsNotRun} not run \u00b7 ${plural(calls.length, "call")}`}
          </p>
          <p className="font-mono text-[12px] text-ink-muted">
            {emails === undefined
              ? "Loading…"
              : `${sortedRight} right \u00b7 ${sortedWrong} wrong \u00b7 ${emailsNotRun} not run \u00b7 ${plural(emails.length, "email")}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onGenerate} disabled={generating}>
            {generating ? "Writing\u2026" : "Generate new set"}
          </Button>
          <Button variant="primary" onClick={onRun} disabled={running}>
            {running ? "Running\u2026" : "Run set"}
          </Button>
          <Link href="/send" className="cb-btn cb-btn-secondary no-underline">
            Try a scam
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-hold-solid">
          {error}
        </p>
      ) : result ? (
        <p role="status" className="font-mono text-[13px] text-ink">
          {runLine(result, calls?.length ?? 0, emails?.length ?? 0)}
        </p>
      ) : null}

      <div className="cb-ledger pt-scroll">
        <div className="min-w-[760px]">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_140px_120px] items-center gap-3 border-b-[1.5px] border-ink px-4 py-2 font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
          <span>Kind</span>
          <span>From</span>
          <span>Checks</span>
          <span>Last run</span>
          <span>Result</span>
        </div>
        {scams === undefined ? (
          <div className="p-6 text-[13px] text-ink-muted">Loading…</div>
        ) : scams.length === 0 ? (
          <div className="p-6 text-[13px] text-ink-muted">No scams yet. Generate a set to get started.</div>
        ) : (
          scams.map((s) => {
            const missing = s.checksThatShouldFire.filter((c) => !s.checksFiredNow.includes(c));
            return (
              <Link
                key={s.key}
                href={`/bills/${s.billKey}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_140px_120px] items-center gap-3 border-t border-line px-4 py-2.5 text-ink no-underline hover:bg-surface-hover"
              >
                <span className="truncate text-[13px]">{s.kind}</span>
                <span className="truncate font-mono text-[12px] text-ink-muted">{s.from}</span>
                <span className="font-mono text-[11px] leading-tight">
                  <span className="block truncate text-ink">
                    Firing: {s.checksFiredNow.length ? s.checksFiredNow.join(", ") : "none"}
                  </span>
                  {missing.length ? (
                    <span className="block truncate text-ink-muted">Missing: {missing.join(", ")}</span>
                  ) : null}
                </span>
                <span className="font-mono text-[12px] text-ink-muted">{shortDate(s.lastRunAt)}</span>
                <span className="font-mono text-[12px] uppercase tracking-wide">
                  {s.caughtLastRun === null ? "Not run" : s.caughtLastRun ? "Caught" : "Missed"}
                </span>
              </Link>
            );
          })
        )}
        </div>
      </div>
      <PracticeCalls calls={calls} />
      <PracticeEmails emails={emails} />
    </div>
  );
}

type PracticeCall = Doc<"practiceCalls">;

const CALL_COLS = "grid grid-cols-[minmax(0,1.6fr)_110px_90px_140px_90px_20px] items-center gap-3";

/** The phone line's Practice set: scripted calls, scam and ordinary, that phone playbook changes replay against. */
function PracticeCalls({ calls }: { calls: PracticeCall[] | undefined }): React.ReactElement {
  // "The Practice call" links on a playbook change land here (#pcall_...): open that row.
  const [open, setOpen] = useOpenFromHash("pcall_");
  return (
    <section className="flex flex-col gap-2" aria-labelledby="practice-calls-head">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
        <h2 id="practice-calls-head" className="font-serif text-[20px]/[26px] text-ink">
          Phone practice calls
        </h2>
        <p className="pt-small">A scam call should be flagged; an ordinary one should not.</p>
      </div>
      <div className="cb-ledger pt-scroll">
        <div className="min-w-[640px]">
          <div className={`${CALL_COLS} border-b-[1.5px] border-ink px-4 py-2 font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted`}>
            <span>Kind</span>
            <span>Expected</span>
            <span>Source</span>
            <span>Last run</span>
            <span>Result</span>
            <span />
          </div>
          {calls === undefined ? (
            <div className="p-6 text-[13px] text-ink-muted">Loading…</div>
          ) : calls.length === 0 ? (
            <div className="p-6 text-[13px] text-ink-muted">
              No practice calls yet. Seed the workspace for the starting set, or report a call from the{" "}
              <Link href="/phone" className="text-ink underline underline-offset-4">
                Phone line
              </Link>
              .
            </div>
          ) : (
            calls.map((c) => {
              const isOpen = open === c.key;
              return (
                <div key={c.key} id={c.key} className="scroll-mt-4 border-t border-line">
                  <button
                    type="button"
                    className={`${CALL_COLS} w-full cursor-pointer border-0 bg-transparent px-4 py-2.5 text-left text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink`}
                    aria-expanded={isOpen}
                    aria-controls={`${c.key}-script`}
                    onClick={() => setOpen(isOpen ? null : c.key)}
                  >
                    <span className="truncate text-[13px]">{c.kind}</span>
                    <span className="font-mono text-[12px] text-ink-muted">{c.expected === "flag" ? "Should flag" : "Should pass"}</span>
                    <span className="font-mono text-[12px] text-ink-muted">{c.source === "seed" ? "Starting set" : "Reported"}</span>
                    <span className="font-mono text-[12px] text-ink-muted">{shortDate(c.lastRunAt)}</span>
                    <span className="font-mono text-[12px] uppercase tracking-wide">
                      {c.caughtLastRun === undefined ? "Not run" : c.caughtLastRun ? "Right" : "Wrong"}
                    </span>
                    <span aria-hidden className={`font-mono text-[12px] text-ink-muted transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}>
                      &rsaquo;
                    </span>
                  </button>
                  <div id={`${c.key}-script`} hidden={!isOpen} className="bg-surface-sunk px-4 py-3">
                    <CallScript text={c.transcript} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

type PracticeEmail = Doc<"practiceEmails">;

const EMAIL_COLS = "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_100px_140px_90px_20px] items-center gap-3";

/** Opens the row a "#pcall_..." or "#pmail_..." link points at (from a playbook change). */
function useOpenFromHash(prefix: string): [string | null, (k: string | null) => void] {
  const [open, setOpen] = React.useState<string | null>(null);
  React.useEffect(() => {
    const fromHash = () => {
      const key = decodeURIComponent(window.location.hash.slice(1));
      if (key.startsWith(prefix)) setOpen(key);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [prefix]);
  return [open, setOpen];
}

/** Inbox triage's Practice set: supplier emails with where a person says each belongs. */
function PracticeEmails({ emails }: { emails: PracticeEmail[] | undefined }): React.ReactElement {
  const [open, setOpen] = useOpenFromHash("pmail_");
  return (
    <section className="flex flex-col gap-2" aria-labelledby="practice-emails-head">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
        <h2 id="practice-emails-head" className="font-serif text-[20px]/[26px] text-ink">
          Practice emails
        </h2>
        <p className="pt-small">Each supplier email should be sorted where a person said it belongs.</p>
      </div>
      <div className="cb-ledger pt-scroll">
        <div className="min-w-[720px]">
          <div className={`${EMAIL_COLS} border-b-[1.5px] border-ink px-4 py-2 font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted`}>
            <span>Kind</span>
            <span>Should go to</span>
            <span>Source</span>
            <span>Last run</span>
            <span>Result</span>
            <span />
          </div>
          {emails === undefined ? (
            <div className="p-6 text-[13px] text-ink-muted">Loading…</div>
          ) : emails.length === 0 ? (
            <div className="p-6 text-[13px] text-ink-muted">
              No practice emails yet. Seed the workspace for the starting set, or correct a message hold sorted wrong from the{" "}
              <Link href="/inbox?status=messages" className="text-ink underline underline-offset-4">
                Inbox
              </Link>
              .
            </div>
          ) : (
            emails.map((e) => {
              const isOpen = open === e.key;
              return (
                <div key={e.key} id={e.key} className="scroll-mt-4 border-t border-line">
                  <button
                    type="button"
                    className={`${EMAIL_COLS} w-full cursor-pointer border-0 bg-transparent px-4 py-2.5 text-left text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink`}
                    aria-expanded={isOpen}
                    aria-controls={`${e.key}-text`}
                    onClick={() => setOpen(isOpen ? null : e.key)}
                  >
                    <span className="truncate text-[13px]">{e.kind}</span>
                    <span className="truncate font-mono text-[12px] text-ink-muted">{capitalise(ROUTE_WORDS[e.expected])}</span>
                    <span className="font-mono text-[12px] text-ink-muted">{e.source === "seed" ? "Starting set" : "Corrected"}</span>
                    <span className="font-mono text-[12px] text-ink-muted">{shortDate(e.lastRunAt)}</span>
                    <span className="font-mono text-[12px] uppercase tracking-wide">
                      {e.caughtLastRun === undefined ? "Not run" : e.caughtLastRun ? "Right" : "Wrong"}
                    </span>
                    <span aria-hidden className={`font-mono text-[12px] text-ink-muted transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}>
                      &rsaquo;
                    </span>
                  </button>
                  <div id={`${e.key}-text`} hidden={!isOpen} className="bg-surface-sunk px-4 py-3">
                    <p className="max-w-[72ch] whitespace-pre-line text-[13.5px]/[21px] text-ink">{e.text}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
