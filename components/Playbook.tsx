"use client";
// Practice screen: "What hold has learned". Teach a technique, the log of playbook changes hold
// proposed and replayed, and the playbook itself with Revert on what hold learned.
import * as React from "react";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Button, Cite, StatusMark } from "@/components/callback";
import { G } from "@/components/callback/glyphs";
import { formatPhone } from "@/components/voice/format";
import {
  IMPROVEMENT_MARK,
  PERSON_NAME,
  channelLabel,
  countWord,
  progressLine,
  recordLink,
  shortDate,
  techniqueSource,
  triggerBy,
  triggerTitle,
  type FraudTechnique,
  type Improvement,
} from "@/lib/playbook";

type Actor = "maya" | "dev";

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
function useRecordNames(practiceCalls: Array<{ key: string; kind: string }>): Record<string, string> {
  const bills = useQuery(api.app.queries.listBills, {});
  const practice = useQuery(practiceListRef, {});
  const line = useQuery(api.voice.ui.phoneLine, {});
  return React.useMemo(() => {
    const names: Record<string, string> = {};
    for (const p of practice ?? []) names[p.billKey] = `the Practice scam “${p.kind}”`;
    for (const b of bills ?? []) names[b.key] = `INV-${b.invoiceNo} · ${b.supplier.name}`;
    for (const c of line?.past ?? []) names[c.call_id] = formatPhone(c.caller_number);
    for (const c of practiceCalls) names[c.key] = c.kind;
    return names;
  }, [bills, practice, line, practiceCalls]);
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

function Mark({ status }: { status: Improvement["status"] }): React.ReactElement {
  const m = IMPROVEMENT_MARK[status];
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

function TeachForm({ actor }: { actor: Actor }): React.ReactElement {
  const teach = useMutation(api.app.techniques.teach);
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const short = text.trim().length < 20;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (short) {
      setError("Describe the technique in a sentence or two so hold can learn it.");
      return;
    }
    setError(null);
    setDone(false);
    setPending(true);
    try {
      await teach({ description: text.trim(), actor });
      setText("");
      setDone(true);
    } catch (err) {
      setError(errorText(err, "hold couldn't take that technique just now. Try again in a minute."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="cb-doc">
      <div className="cb-doc-head">
        <span>Teach hold a technique</span>
        <small>As {PERSON_NAME[actor]}</small>
      </div>
      <div className="pt-compose">
        <label htmlFor="teach-text" className="pt-small">
          Paste an FBI or bank advisory, or describe a call or email you got. hold writes it up as a technique, replays it against
          past cases, and only adds it if nothing regresses.
        </label>
        <textarea
          id="teach-text"
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDone(false);
          }}
          placeholder="A caller said they were from our bank's fraud team and asked us to read back the code they had just texted..."
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
  const word = (v: "flag" | "pass") => (v === "flag" ? "Flag" : "Pass");
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

function Decide({ impr, actor }: { impr: Improvement; actor: Actor }): React.ReactElement {
  const decide = useMutation(api.app.techniques.decideImprovement);
  const [pending, setPending] = React.useState<"approve" | "decline" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (actor !== "dev") {
    return (
      <div className="pt-decide">
        <Button variant="primary" size="sm" locked="Only Dev can approve a change that makes hold less strict.">
          Approve change
        </Button>
      </div>
    );
  }

  async function go(decision: "approve" | "decline") {
    setError(null);
    setPending(decision);
    try {
      await decide({ key: impr.key, decision, actor });
    } catch (err) {
      setError(errorText(err, "Couldn't record that decision. Try again."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="pt-decide">
      <p className="pt-small">This change makes hold less strict, so it waits for you.</p>
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

function ImprovementRow({ impr, actor, names }: { impr: Improvement; actor: Actor; names: Record<string, string> }) {
  const by = triggerBy(impr.trigger);
  const p = impr.proposal;
  const progress = progressLine(impr);
  const link = recordLink(impr.trigger.billKey ?? impr.trigger.callId);
  return (
    <article id={impr.key} className="scroll-mt-4 border-t border-line px-4 py-4 first:border-0" aria-label={triggerTitle(impr.trigger, names)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="pt-strong text-ink">{triggerTitle(impr.trigger, names)}</h3>
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
        <Mark status={impr.status} />
      </div>

      {impr.trigger.kind === "taught" && impr.trigger.by !== "callback" ? (
        <p className="mt-2 line-clamp-3 font-serif text-[15px]/[22px] italic text-signatory">&ldquo;{impr.trigger.text}&rdquo;</p>
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
            {p.action === "refine" ? "Proposed refinement" : "Proposed technique"} &middot; {channelLabel(p.channel)}
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

      {impr.status === "needs_approval" ? <Decide impr={impr} actor={actor} /> : null}
    </article>
  );
}

// ---------- the playbook ----------

function Revert({ t, actor }: { t: FraudTechnique; actor: Actor }): React.ReactElement {
  const revert = useMutation(api.app.techniques.revertTechnique);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function go() {
    setError(null);
    setPending(true);
    try {
      await revert({ techniqueKey: t.key, actor });
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
        hold stops using it on new {t.channel === "phone" ? "calls" : t.channel === "both" ? "bills and calls" : "bills"}{t.supersedes ? " and goes back to the version it replaced" : ""}.
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
  actor,
  improvements,
  names,
}: {
  t: FraudTechnique;
  actor: Actor;
  improvements: Improvement[];
  names: Record<string, string>;
}) {
  const src = techniqueSource(t, improvements, names);
  return (
    <article id={t.key} className="grid scroll-mt-4 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] border-t border-line px-4 py-3.5 first:border-0" aria-label={t.name}>
      <div className="min-w-0">
        <h3 className="pt-strong text-ink">{t.name}</h3>
        <p className="cb-caps mt-0.5">{channelLabel(t.channel)}</p>
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
          <Revert t={t} actor={actor} />
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

function Learned({ actor }: { actor: Actor }): React.ReactElement {
  const data = useQuery(api.app.techniques.list, {});
  const names = useRecordNames(data?.practiceCalls ?? NO_CALLS);
  const [filter, setFilter] = React.useState<ChannelFilter>("all");

  if (data === undefined) {
    return (
      <div className="cb-doc p-4 font-mono text-[13px] text-ink-muted" role="status">
        <span className="cb-dots">Loading the playbook</span>
      </div>
    );
  }

  const { techniques, improvements } = data;
  const active = techniques.filter((t) => t.status === "active");
  const retired = techniques.filter((t) => t.status === "retired");
  const email = active.filter((t) => onChannel(t, "email")).length;
  const phone = active.filter((t) => onChannel(t, "phone")).length;
  const learned = active.filter((t) => t.sourceKind !== "seed").length;
  const working = improvements.filter((i) => i.status === "proposing" || i.status === "replaying").length;
  const waiting = improvements.filter((i) => i.status === "needs_approval").length;
  const shown = active.filter((t) => onChannel(t, filter));

  const sentence =
    `hold checks every incoming bill against ${techniqueCount(email, "email technique")} and every call to the phone line against ${techniqueCount(phone, "phone tactic")}` +
    (learned ? `. ${countWord(learned)} of them ${learned === 1 ? "was" : "were"} learned here.` : ", all from the starting playbook.") +
    (working ? ` ${countWord(working)} ${working === 1 ? "change is" : "changes are"} replaying now.` : "") +
    (waiting ? ` ${countWord(waiting)} ${waiting === 1 ? "waits" : "wait"} for Dev.` : "");

  return (
    <>
      <p className="pt-sub">{sentence}</p>

      <TeachForm actor={actor} />

      <section className="cb-doc" aria-labelledby="changes-head">
        <div className="cb-doc-head">
          <span id="changes-head">Changes hold proposed</span>
          <small>Newest first</small>
        </div>
        {improvements.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-ink-muted">
            Nothing yet. Run the Practice set above, report a scam hold missed from its bill page or the Phone line, or teach it a technique.
          </p>
        ) : (
          <div>
            {improvements.map((i) => (
              <ImprovementRow key={i.key} impr={i} actor={actor} names={names} />
            ))}
          </div>
        )}
      </section>

      <section className="cb-doc" aria-labelledby="playbook-head">
        <div className="cb-doc-head">
          <span id="playbook-head">The playbook</span>
          <small>{active.length} active</small>
        </div>
        {active.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-ink-muted">The playbook is empty. Seed the workspace to load the starting playbook.</p>
        ) : (
          <>
            <div className="pt-filters border-b border-line px-4 py-3" role="group" aria-label="Show techniques for">
              {FILTERS.map((f) => (
                <button key={f.value} type="button" className={`pt-filter${filter === f.value ? " on" : ""}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}
                  <span className="pt-count">{f.value === "all" ? active.length : f.value === "email" ? email : phone}</span>
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-ink-muted">
                No {filter === "phone" ? "phone tactics" : "email techniques"} yet. Teach hold one above, or seed the workspace.
              </p>
            ) : (
              <div>
                {shown.map((t) => (
                  <TechniqueRow key={t.key} t={t} actor={actor} improvements={improvements} names={names} />
                ))}
              </div>
            )}
          </>
        )}
        {retired.length > 0 ? (
          <details className="border-t border-line">
            <summary className="cb-ask cursor-pointer px-4 py-3 text-[13px]">
              {countWord(retired.length)} retired {retired.length === 1 ? "technique" : "techniques"}
            </summary>
            <div className="border-t border-line">
              {retired.map((t) => (
                <TechniqueRow key={t.key} t={t} actor={actor} improvements={improvements} names={names} />
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </>
  );
}

const NO_CALLS: Array<{ key: string; kind: string }> = [];

class LoadBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="cb-doc flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
        <p className="font-mono text-[13px] text-ink">hold couldn&rsquo;t load the playbook. The backend may still be deploying.</p>
        <Button size="sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </Button>
      </div>
    );
  }
}

export function Playbook({ actor }: { actor: Actor }): React.ReactElement {
  return (
    <div id="learned" className="flex flex-col gap-4 px-6 pb-6">
      <h2 id="learned-head" className="font-serif text-[24px]/[30px] text-ink">
        What hold has learned
      </h2>
      <LoadBoundary>
        <Learned actor={actor} />
      </LoadBoundary>
    </div>
  );
}
