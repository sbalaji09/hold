"use client";
// Practice screen: "What hold has learned", per job on hold's loop (Fraud, and Inbox triage).
// Teach it, the log of playbook changes hold proposed and replayed, and the playbook itself with
// Revert on what hold learned.
import * as React from "react";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Button, Cite, StatusMark } from "@/components/callback";
import { G } from "@/components/callback/glyphs";
import { formatPhone } from "@/components/voice/format";
import { capitalise } from "@/components/RouteCorrection";
import { ROUTE_WORDS, type Route } from "@/lib/triage";
import {
  channelLabel,

  countWord,
  improvementMark,
  progressLine,
  recordLink,
  shortDate,
  techniqueSource,
  triggerBy,
  triggerTitle,
  type FraudTechnique,
  type Improvement,
} from "@/lib/playbook";

type Job = "fraud" | "triage";

const jobOf = (r: { job?: Job }): Job => r.job ?? "fraud";

// Same name-addressed reference app/practice/page.tsx uses for the Practice set.
const practiceListRef = makeFunctionReference<"query", Record<string, never>, Array<{ billKey: string; kind: string }>>("app/practice:list");

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ConvexError && typeof err.data === "string") return err.data;
  return fallback;
}

/**
 * Bill key, call id or Practice call key to the name a person knows it by: the invoice for real
 * bills, the kind for Practice scams and calls, the caller's number for calls to the phone line.
 */
function useRecordNames(practiceCalls: Array<{ key: string; kind: string }>, practiceEmails: Array<{ key: string; kind: string }>): Record<string, string> {
  const bills = useQuery(api.app.queries.listBills, {});
  const practice = useQuery(practiceListRef, {});
  const line = useQuery(api.voice.ui.phoneLine, {});
  const messages = useQuery(api.app.triage.messages, {});
  return React.useMemo(() => {
    const names: Record<string, string> = {};
    for (const p of practice ?? []) names[p.billKey] = `the Practice scam “${p.kind}”`;
    for (const b of bills ?? []) names[b.key] = `INV-${b.invoiceNo} · ${b.supplier.name}`;
    for (const c of line?.past ?? []) names[c.call_id] = formatPhone(c.caller_number);
    for (const c of practiceCalls) names[c.key] = c.kind;
    for (const e of practiceEmails) names[e.key] = e.kind;
    for (const m of [...(messages?.open ?? []), ...(messages?.done ?? []), ...(messages?.filed ?? [])]) names[m.key] = m.subject;
    return names;
  }, [bills, practice, line, messages, practiceCalls, practiceEmails]);
}

/**
 * A call transcript as the backend stores it for learning: "Caller: ..." and "hold: ..." lines.
 * The caller's words are quoted (signatory serif); hold's are its own (mono). Long calls show
 * their first `clamp` lines until opened.
 */
export function CallScript({ text, clamp }: { text: string; clamp?: number }): React.ReactElement {
  const [all, setAll] = React.useState(false);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(Caller|hold):\s*(.*)$/.exec(l);
      return m ? { who: m[1], said: m[2] } : { who: "", said: l };
    });
  const shown = clamp && !all ? lines.slice(0, clamp) : lines;
  return (
    <div className="flex flex-col gap-1.5">
      <dl className="m-0 flex flex-col gap-1.5">
        {shown.map((l, i) => (
          <div key={i} className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3">
            <dt className="cb-caps pt-[3px]">{l.who}</dt>
            <dd className={l.who === "hold" ? "m-0 font-mono text-[12.5px]/[20px] text-ink" : "m-0 font-serif text-[15px]/[21px] italic text-signatory"}>
              {l.who === "Caller" ? <>&ldquo;{l.said}&rdquo;</> : l.said}
            </dd>
          </div>
        ))}
      </dl>
      {clamp && lines.length > clamp ? (
        <button type="button" className="cb-ask self-start text-[12.5px]" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Show less" : `Show the whole call (${lines.length} lines)`}
        </button>
      ) : null}
    </div>
  );
}

function Mark({ impr }: { impr: Improvement }): React.ReactElement {
  const m = improvementMark(impr);
  if (m.mark) return <StatusMark status={m.mark}>{m.label}</StatusMark>;
  return (
    <span className="cb-mark cb-mark-paid" role="status">
      {G.x()}
      {m.label}
    </span>
  );
}

function Person({ name }: { name: string }): React.ReactElement {
  return <span className="font-serif text-[15px] italic text-signatory">{name}</span>;
}

function Signals({ signals }: { signals: string[] }): React.ReactElement | null {
  if (signals.length === 0) return null;
  return (
    <ul className="mt-2 flex list-none flex-col gap-1 p-0">
      {signals.map((s, i) => (
        <li key={i} className="grid grid-cols-[12px_minmax(0,1fr)] font-mono text-[12px]/[18px] text-ink-muted">
          <span aria-hidden>-</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- teach ----------

const TEACH: Record<Job, { head: string; label: string; short: string; placeholder: string; failed: string }> = {
  fraud: {
    head: "Teach hold a technique",
    label:
      "Paste an FBI or bank advisory, or describe a call or email you got. hold writes it up as a technique, replays it against past cases, and only adds it if nothing regresses.",
    short: "Describe the technique in a sentence or two so hold can learn it.",
    placeholder: "A caller said they were from our bank's fraud team and asked us to read back the code they had just texted...",
    failed: "hold couldn't take that technique just now. Try again in a minute.",
  },
  triage: {
    head: "Teach hold a kind of email",
    label:
      "Describe a kind of email suppliers send and where it belongs. hold writes it up as a kind of email, replays it against the practice emails and paid invoices, and only adds it if nothing regresses.",
    short: "Describe the kind of email in a sentence or two so hold can learn it.",
    placeholder: "Suppliers send a credit note when an order is cancelled. It isn't a bill to pay; it should be seen so it can be matched to the invoice...",
    failed: "hold couldn't take that kind of email just now. Try again in a minute.",
  },
};

function TeachForm({ job }: { job: Job }): React.ReactElement {
  const words = TEACH[job];
  const teach = useMutation(api.app.techniques.teach);
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const short = text.trim().length < 20;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (short) {
      setError(words.short);
      return;
    }
    setError(null);
    setDone(false);
    setPending(true);
    try {
      await teach({ description: text.trim(), actor: "dev", job });
      setText("");
      setDone(true);
    } catch (err) {
      setError(errorText(err, words.failed));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="cb-doc">
      <div className="cb-doc-head">
        <span>{words.head}</span>
        <small>Your proposal</small>
      </div>
      <div className="pt-compose">
        <label htmlFor="teach-text" className="pt-small">
          {words.label}
        </label>
        <textarea
          id="teach-text"
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDone(false);
          }}
          placeholder={words.placeholder}
          aria-describedby={error ? "teach-error" : undefined}
          disabled={pending}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Sending…" : "Teach hold"}
          </Button>
          {error ? (
            <p id="teach-error" role="alert" className="font-mono text-[12px] text-hold">
              {error}
            </p>
          ) : done ? (
            <p role="status" className="font-mono text-[12px] text-ink-muted">
              hold is learning this. It shows up in the log below.
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

// ---------- improvements log ----------

function ReplayTable({ cases, names }: { cases: NonNullable<Improvement["replay"]>["cases"]; names: Record<string, string> }) {
  // Fraud cases are flag/pass; triage cases are routes.
  const word = (v: string) => ({ flag: "Flag", pass: "Pass", bill: "Bill", to_dev: "To you", file: "File" })[v] ?? v;
  return (
    <div className="mt-2 overflow-x-auto rounded-sm border border-line">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="cb-caps border-b-[1.5px] border-ink">
            <th className="px-3 py-2 font-semibold">Case</th>
            <th className="px-3 py-2 font-semibold">Should</th>
            <th className="px-3 py-2 font-semibold">Before</th>
            <th className="px-3 py-2 font-semibold">With the change</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, i) => (
            <tr key={i} className="border-t border-line font-mono text-[12px]/[18px] text-ink first:border-0">
              <td className="px-3 py-1.5">
                {c.billKey ? (
                  <a href={`/bills/${encodeURIComponent(c.billKey)}`} className="text-ink underline decoration-line-control underline-offset-4 hover:decoration-ink" title={names[c.billKey]}>
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
              </td>
              <td className="px-3 py-1.5">{word(c.expected)}</td>
              <td className="px-3 py-1.5 text-ink-muted">
                {word(c.before)}
                {c.before !== c.expected ? " (wrong)" : ""}
              </td>
              <td className={c.after !== c.expected ? "px-3 py-1.5 font-semibold" : "px-3 py-1.5"}>
                {word(c.after)}
                {c.after !== c.expected ? " (wrong)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Decide({ impr }: { impr: Improvement }): React.ReactElement {
  const decide = useMutation(api.app.techniques.decideImprovement);
  const [pending, setPending] = React.useState<"approve" | "decline" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function go(decision: "approve" | "decline") {
    setError(null);
    setPending(decision);
    try {
      await decide({ key: impr.key, decision, actor: "dev" });
    } catch (err) {
      setError(errorText(err, "Couldn't record that decision. Try again."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="pt-decide">
      <p className="pt-small">This change {impr.job === "triage" ? "files some email away where no one sees it" : "makes hold less strict"}, so it waits for you.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={pending !== null} onClick={() => go("approve")}>
          {pending === "approve" ? "Approving…" : "Approve change"}
        </Button>
        <Button size="sm" disabled={pending !== null} onClick={() => go("decline")}>
          {pending === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="font-mono text-[12px] text-hold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ImprovementRow({ impr, names }: { impr: Improvement; names: Record<string, string> }) {
  const by = triggerBy(impr.trigger);
  const p = impr.proposal;
  const progress = progressLine(impr);
  const link = recordLink(impr.trigger.billKey ?? impr.trigger.callId ?? impr.trigger.emailKey);
  const title = triggerTitle(impr.trigger, names, impr.job);
  const expected = impr.trigger.expected as Route | undefined;
  return (
    <article id={impr.key} className="scroll-mt-4 border-t border-line px-4 py-4 first:border-0" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="pt-strong text-ink">{title}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
            <span>
              {by.text} {by.person ? <Person name={by.person} /> : null}
            </span>
            <span className="whitespace-nowrap font-mono">
              <span aria-hidden>&middot; </span>
              {shortDate(impr.createdAt)}
            </span>
            {link ? <Cite href={link.href}>{link.label}</Cite> : null}
          </p>
        </div>
        <Mark impr={impr} />
      </div>

      {impr.trigger.kind === "taught" && impr.trigger.by !== "callback" ? (
        <p className="mt-2 line-clamp-3 font-serif text-[15px]/[22px] italic text-signatory">&ldquo;{impr.trigger.text}&rdquo;</p>
      ) : null}

      {impr.job === "triage" && impr.trigger.kind === "corrected" && expected && ROUTE_WORDS[expected] ? (
        <p className="mt-2 font-mono text-[12.5px]/[19px] text-ink">Should be {ROUTE_WORDS[expected]}.</p>
      ) : null}

      {impr.trigger.callId ? (
        <div className="mt-3">
          <CallScript text={impr.trigger.text} clamp={4} />
        </div>
      ) : null}

      {progress ? (
        <p className="mt-3 font-mono text-[13px] text-graphite" role="status">
          {progress}
        </p>
      ) : null}

      {p ? (
        <div className="mt-3 rounded-sm bg-surface-sunk px-3 py-2.5">
          <div className="cb-caps">
            {p.action === "refine" ? "Proposed refinement" : impr.job === "triage" ? "Proposed kind of email" : "Proposed technique"} &middot;{" "}
            {impr.job === "triage" ? capitalise(ROUTE_WORDS[p.route ?? "to_dev"]) : channelLabel(p.channel)}
          </div>
          <p className="mt-1 text-[14px] font-semibold text-ink">{p.name}</p>
          <p className="mt-1 text-[13px]/[20px] text-ink">{p.howItWorks}</p>
          <Signals signals={p.signals} />
        </div>
      ) : null}

      {impr.summary ? <p className="pt-statement">{impr.summary}</p> : null}

      {impr.replay && impr.replay.cases.length > 0 ? (
        <details className="mt-2">
          <summary className="cb-ask cursor-pointer text-[12.5px]">
            Replay cases ({impr.replay.cases.length}
            {impr.replay.attempts > 1 ? `, ${impr.replay.attempts} attempts` : ""})
          </summary>
          <ReplayTable cases={impr.replay.cases} names={names} />
        </details>
      ) : null}

      {impr.status === "needs_approval" ? <Decide impr={impr} /> : null}
    </article>
  );
}

// ---------- the playbook ----------

function Revert({ t }: { t: FraudTechnique }): React.ReactElement {
  const revert = useMutation(api.app.techniques.revertTechnique);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function go() {
    setError(null);
    setPending(true);
    try {
      await revert({ techniqueKey: t.key, actor: "dev" });
    } catch (err) {
      setError(errorText(err, "Couldn't revert it. Try again."));
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button size="sm" onClick={() => setConfirming(true)}>
        Revert
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1.5" onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}>
      <p className="max-w-[260px] text-right text-[12px]/[17px] text-ink-muted">
        {t.job === "triage"
          ? "hold stops sorting new email by it"
          : `hold stops using it on new ${t.channel === "phone" ? "calls" : t.channel === "both" ? "bills and calls" : "bills"}`}
        {t.supersedes ? " and goes back to the version it replaced" : ""}.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setConfirming(false)} disabled={pending}>
          Keep it
        </Button>
        <Button size="sm" variant="primary" onClick={go} disabled={pending} autoFocus>
          {pending ? "Reverting…" : "Revert"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="font-mono text-[12px] text-hold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TechniqueRow({
  t,
  improvements,
  names,
}: {
  t: FraudTechnique;
  improvements: Improvement[];
  names: Record<string, string>;
}) {
  const src = techniqueSource(t, improvements, names);
  return (
    <article id={t.key} className="grid scroll-mt-4 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] border-t border-line px-4 py-3.5 first:border-0" aria-label={t.name}>
      <div className="min-w-0">
        <h3 className="pt-strong text-ink">{t.name}</h3>
        <p className="cb-caps mt-0.5">{t.job === "triage" ? capitalise(ROUTE_WORDS[t.route ?? "to_dev"]) : channelLabel(t.channel)}</p>
        <p className="mt-1 text-[13px]/[20px] text-ink">{t.howItWorks}</p>
        <Signals signals={t.signals} />
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
          <span>
            {src.text} {src.person ? <Person name={src.person} /> : null}
          </span>
          <span className="whitespace-nowrap font-mono">
            <span aria-hidden>&middot; </span>
            {shortDate(t.createdAt)}
          </span>
          {src.link ? <Cite href={src.link.href}>{src.link.label}</Cite> : null}
          {t.improvementKey ? <Cite href={`#${t.improvementKey}`}>The change</Cite> : null}
        </p>
      </div>
      {t.status === "active" && t.sourceKind !== "seed" ? (
        <div className="self-start">
          <Revert t={t} />
        </div>
      ) : null}
    </article>
  );
}

// ---------- the section ----------

type ChannelFilter = "all" | "email" | "phone";

const FILTERS: Array<{ value: ChannelFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

/** A "both" technique belongs under Email and under Phone. */
function onChannel(t: FraudTechnique, f: ChannelFilter): boolean {
  if (f === "all" || t.channel === "both") return true;
  return f === "phone" ? t.channel === "phone" : t.channel !== "phone";
}

function techniqueCount(n: number, what: string): string {
  return `${n === 1 ? "one" : countWord(n).toLowerCase()} ${what}${n === 1 ? "" : "s"}`;
}

const JOBS: Array<{ value: Job; label: string }> = [
  { value: "fraud", label: "Fraud" },
  { value: "triage", label: "Inbox" },
];

/**
 * A "#impr_..." or "#tech_..." link (from the Activity log, a bill, a message) opens the job tab
 * it belongs to and scrolls to it, once.
 */
function useJobFromHash(rows: Array<{ key: string; job?: Job }> | undefined, job: Job, setJob: (j: Job) => void): void {
  const [hash, setHash] = React.useState("");
  React.useEffect(() => {
    const read = () => setHash(decodeURIComponent(window.location.hash.slice(1)));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  React.useEffect(() => {
    const row = hash ? rows?.find((r) => r.key === hash) : undefined;
    if (!row) return;
    if (jobOf(row) !== job) return setJob(jobOf(row));
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
    setHash("");
  }, [rows, hash, job, setJob]);
}

function Learned(): React.ReactElement {
  const data = useQuery(api.app.techniques.list, {});
  const names = useRecordNames(data?.practiceCalls ?? NO_CALLS, data?.practiceEmails ?? NO_CALLS);
  const [job, setJob] = React.useState<Job>("fraud");
  const [filter, setFilter] = React.useState<ChannelFilter>("all");
  const rows = React.useMemo(() => (data ? [...data.techniques, ...data.improvements] : undefined), [data]);
  useJobFromHash(rows, job, setJob);

  if (data === undefined) {
    return (
      <div className="cb-doc p-4 font-mono text-[13px] text-ink-muted" role="status">
        <span className="cb-dots">Loading the playbook</span>
      </div>
    );
  }

  const triage = job === "triage";
  const techniques = data.techniques.filter((t) => jobOf(t) === job);
  const improvements = data.improvements.filter((i) => jobOf(i) === job);
  const active = techniques.filter((t) => t.status === "active");
  const retired = techniques.filter((t) => t.status === "retired");
  const email = active.filter((t) => onChannel(t, "email")).length;
  const phone = active.filter((t) => onChannel(t, "phone")).length;
  const learned = active.filter((t) => t.sourceKind !== "seed").length;
  const working = improvements.filter((i) => i.status === "proposing" || i.status === "replaying").length;
  const waiting = improvements.filter((i) => i.status === "needs_approval").length;
  const shown = triage ? active : active.filter((t) => onChannel(t, filter));
  const activeIn = (j: Job) => data.techniques.filter((t) => t.status === "active" && jobOf(t) === j).length;

  const sentence =
    (triage
      ? `hold sorts every email from a known supplier by ${techniqueCount(active.length, "kind")} of email before anything else happens`
      : `hold checks every incoming bill against ${techniqueCount(email, "email technique")} and every call to the phone line against ${techniqueCount(phone, "phone tactic")}`) +
    (learned ? `. ${countWord(learned)} of them ${learned === 1 ? "was" : "were"} learned here.` : ", all from the starting playbook.") +
    (working ? ` ${countWord(working)} ${working === 1 ? "change is" : "changes are"} replaying now.` : "") +
    (waiting ? ` ${countWord(waiting)} ${waiting === 1 ? "waits" : "wait"} for you.` : "");

  return (
    <>
      <div className="pt-filters" role="group" aria-label="Which job">
        {JOBS.map((j) => (
          <button key={j.value} type="button" className={`pt-filter${job === j.value ? " on" : ""}`} aria-pressed={job === j.value} onClick={() => setJob(j.value)}>
            {j.label}
            <span className="pt-count">{activeIn(j.value)}</span>
          </button>
        ))}
      </div>

      <p className="pt-sub">{sentence}</p>

      <TeachForm key={job} job={job} />

      <section className="cb-doc" aria-labelledby="changes-head">
        <div className="cb-doc-head">
          <span id="changes-head">Changes hold proposed</span>
          <small>Newest first</small>
        </div>
        {improvements.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-ink-muted">
            {triage
              ? "Nothing yet. Run the Practice set above, tell hold a message was sorted wrong from the Inbox, or teach it a kind of email."
              : "Nothing yet. Run the Practice set above, report a scam hold missed from its bill page or the Phone line, or teach it a technique."}
          </p>
        ) : (
          <div>
            {improvements.map((i) => (
              <ImprovementRow key={i.key} impr={i} names={names} />
            ))}
          </div>
        )}
      </section>

      <section className="cb-doc" aria-labelledby="playbook-head">
        <div className="cb-doc-head">
          <span id="playbook-head">{triage ? "Kinds of email" : "The playbook"}</span>
          <small>{active.length} active</small>
        </div>
        {active.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-ink-muted">
            {triage ? "hold knows no kinds of email yet. Seed the workspace to load the starting set, or teach it one above." : "The playbook is empty. Seed the workspace to load the starting playbook."}
          </p>
        ) : (
          <>
            {triage ? null : (
              <div className="pt-filters border-b border-line px-4 py-3" role="group" aria-label="Show techniques for">
                {FILTERS.map((f) => (
                  <button key={f.value} type="button" className={`pt-filter${filter === f.value ? " on" : ""}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                    {f.label}
                    <span className="pt-count">{f.value === "all" ? active.length : f.value === "email" ? email : phone}</span>
                  </button>
                ))}
              </div>
            )}
            {shown.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-ink-muted">
                No {filter === "phone" ? "phone tactics" : "email techniques"} yet. Teach hold one above, or seed the workspace.
              </p>
            ) : (
              <div>
                {shown.map((t) => (
                  <TechniqueRow key={t.key} t={t} improvements={improvements} names={names} />
                ))}
              </div>
            )}
          </>
        )}
        {retired.length > 0 ? (
          <details className="border-t border-line">
            <summary className="cb-ask cursor-pointer px-4 py-3 text-[13px]">
              {countWord(retired.length)} retired {triage ? (retired.length === 1 ? "kind of email" : "kinds of email") : retired.length === 1 ? "technique" : "techniques"}
            </summary>
            <div className="border-t border-line">
              {retired.map((t) => (
                <TechniqueRow key={t.key} t={t} improvements={improvements} names={names} />
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </>
  );
}

const NO_CALLS: Array<{ key: string; kind: string }> = [];

/** A live query that failed (the backend may be deploying): a written state with a retry. */
export class LoadBoundary extends React.Component<{ children: React.ReactNode; what?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="cb-doc flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
        <p className="font-mono text-[13px] text-ink">hold couldn&rsquo;t load {this.props.what ?? "the playbook"}. The backend may still be deploying.</p>
        <Button size="sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </Button>
      </div>
    );
  }
}

export function Playbook(): React.ReactElement {
  return (
    <div id="learned" className="flex flex-col gap-4 px-6 pb-6">
      <h2 id="learned-head" className="font-serif text-[24px]/[30px] text-ink">
        What hold has learned
      </h2>
      <LoadBoundary>
        <Learned />
      </LoadBoundary>
    </div>
  );
}

/**
 * Approvals screen: playbook changes that make hold less strict wait here for you (fraud,
 * inbox sorting). Renders nothing when none are waiting.
 */
export function PlaybookApprovals(): React.ReactElement | null {
  const data = useQuery(api.app.techniques.list, {});
  const names = useRecordNames(data?.practiceCalls ?? NO_CALLS, data?.practiceEmails ?? NO_CALLS);
  const waiting = (data?.improvements ?? []).filter((i) => i.status === "needs_approval");
  if (waiting.length === 0) return null;
  return (
    <section className="cb-doc" aria-labelledby="playbook-approvals-head">
      <div className="cb-doc-head">
        <span id="playbook-approvals-head">Changes to how hold checks</span>
        <small>{waiting.length}</small>
      </div>
      {waiting.map((i) => (
        <ImprovementRow key={i.key} impr={i} names={names} />
      ))}
    </section>
  );
}
