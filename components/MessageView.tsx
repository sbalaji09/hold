"use client";
// A supplier email hold sorted as a message, not a bill: the email, how hold sorted it and why, and
// what Maya (or Dev) can do: mark it done, or say it was sorted wrong so hold moves it and learns.
// Live, so a message corrected to a bill links to the bill as soon as the bill checks create it.
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, Cite, LogEntry, StatusMark } from "@/components/callback";
import { LoadBoundary, errorText } from "@/components/Playbook";
import { RouteCorrection, capitalise } from "@/components/RouteCorrection";
import { MESSAGE_MARK } from "@/lib/inbox";
import { PERSON_NAME } from "@/lib/playbook";
import { ROUTE_WORDS, type Route } from "@/lib/triage";
import { useCompany } from "@/lib/useCompany";
import type { Company } from "@/lib/company";

type Actor = "maya" | "dev";
const ROUTES: Route[] = ["bill", "to_maya", "file"];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function Person({ name }: { name: string }): React.ReactElement {
  return <span className="font-serif text-[15px] italic text-signatory">{name}</span>;
}

function consequence(r: Route, supplier: string, co: Company): string {
  if (r === "bill") return "hold runs it through the full bill checks, like any new bill. Nothing is paid unless they pass.";
  if (r === "file") return `hold files it on ${supplier}'s record and it leaves the inbox.`;
  return `It stays in ${co.maya.name}'s inbox as a message until someone marks it done.`;
}

/** The bill the bill checks made from this email, once they have. */
function useBillFor(emailKey: string, look: boolean) {
  const bills = useQuery(api.app.queries.listBills, look ? {} : "skip");
  return bills?.find((b) => b.emailKey === emailKey) ?? null;
}

function View({ emailKey, actor }: { emailKey: string; actor: Actor }): React.ReactElement {
  const co = useCompany();
  const ACTOR_NAME = { callback: "hold", maya: co.maya.full, dev: co.dev.full } as const;
  const data = useQuery(api.app.triage.getMessage, { emailKey });
  const activity = useQuery(api.app.queries.listActivity, {});
  const resolve = useMutation(api.app.triage.resolveMessage);
  const correct = useMutation(api.app.triage.correctMessage);
  const [doneError, setDoneError] = React.useState<string | null>(null);
  const [marking, setMarking] = React.useState(false);

  const m = data ?? undefined;
  const t = m?.triage;
  // Not a message (any more): it may have become a bill.
  const bill = useBillFor(emailKey, data !== undefined && (!m || t?.correctedRoute === "bill"));

  if (data === undefined) {
    return (
      <div className="cb-doc p-4 font-mono text-[13px] text-ink-muted" role="status">
        <span className="cb-dots">Loading the message</span>
      </div>
    );
  }

  if (!m || !t) {
    return (
      <div className="flex flex-col gap-4">
        <div className="cb-caps">
          <Link href="/inbox">Inbox</Link> / Message
        </div>
        <div className="cb-doc flex flex-col items-start gap-3 p-5">
          {bill ? (
            <>
              <p className="font-mono text-[13px]/[20px] text-ink">This email went through the bill checks and is a bill now.</p>
              <Link href={`/bills/${encodeURIComponent(bill.key)}`} className="cb-btn cb-btn-primary">
                Open INV-{bill.invoiceNo}
              </Link>
            </>
          ) : (
            <>
              <p className="font-mono text-[13px]/[20px] text-ink">hold has no message with this link.</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/inbox" className="cb-btn cb-btn-secondary">Back to the Inbox</Link>
                <Link href="/inbox?status=filed" className="cb-btn cb-btn-secondary">Done and filed</Link>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const now: Route = t.correctedRoute ?? t.route;
  const mark = MESSAGE_MARK[t.status];
  const entries = (activity ?? []).filter((e) => e.refKind === "email" && e.refKey === emailKey); // newest first
  const timeline = [...entries].reverse();
  // Stored since triage recorded it; the Activity log covers corrections made before that.
  const correctedBy = t.correctedBy ?? entries.find((e) => e.actor !== "callback" && e.what.startsWith("said this email is"))?.actor;
  const corrector = correctedBy === "maya" || correctedBy === "dev" ? correctedBy : null;
  const toBill = t.correctedRoute === "bill";
  const paragraphs = m.body.split(/\n+/).filter((l) => l.trim().length > 0);

  async function markDone() {
    setDoneError(null);
    setMarking(true);
    try {
      await resolve({ emailKey, actor });
    } catch (err) {
      setDoneError(errorText(err, "hold couldn't mark it done just now. Try again."));
    } finally {
      setMarking(false);
    }
  }

  async function move(r: Route): Promise<React.ReactNode> {
    const res = await correct({ emailKey, route: r, actor });
    const learning = res.key ? (
      <>
        hold is learning from the correction.
      </>
    ) : (
      "hold is already learning from this email."
    );
    if (r === "bill") return <>hold is running the bill checks on it. {learning}</>;
    return <>Moved: {ROUTE_WORDS[r]}. {learning}</>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 min-[1101px]:grid-cols-[minmax(0,1fr)_var(--evidence-width)]">
      <div className="col-span-full flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[min(100%,360px)] flex-1 basis-0">
          <div className="cb-caps">
            <Link href="/inbox">Inbox</Link> / {m.supplierName} / Message
          </div>
          <h1 className="font-serif text-[24px]/[30px] text-ink">{m.subject}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-start gap-2.5">
          {toBill ? (
            <Button locked="It's going through the bill checks. Use Not a bill on the bill page if that was wrong.">Sorted wrong</Button>
          ) : (
            <RouteCorrection
              id="sorted-wrong"
              label="Sorted wrong"
              intro={`hold sorted this as ${ROUTE_WORDS[now]}. Where does it belong?`}
              options={ROUTES}
              current={now}
              consequence={(r) => `${consequence(r, m.supplierName, co)} hold learns from the correction and replays it before it changes how it sorts.`}
              confirmLabel="Move it"
              onMove={move}
            />
          )}
          {t.status === "open" ? (
            <Button variant="primary" icon="tick" onClick={markDone} disabled={marking}>
              {marking ? "Marking…" : "Done"}
            </Button>
          ) : (
            <Button variant="primary" locked={toBill ? "It's a bill now." : t.status === "filed" ? "Filed on the supplier record. Nothing to do." : "Already marked done."}>
              Done
            </Button>
          )}
        </div>
        {doneError ? (
          <p role="alert" className="basis-full text-right font-mono text-[12px] text-hold">
            {doneError}
          </p>
        ) : null}
      </div>

      <article className="cb-doc relative min-w-0 self-start p-5">
        <div className="grid grid-cols-[64px_1fr] gap-y-0.5 border-b border-dashed border-line pb-3 font-mono text-[12px]/[18px] text-ink-muted">
          <span>From</span>
          <b className="font-normal text-ink [overflow-wrap:anywhere]">{m.fromAddress}</b>
          <span>To</span>
          <b className="font-normal text-ink">{co.inbox}</b>
          <span>Received</span>
          <b className="font-normal text-ink">{formatDateTime(m.receivedAt)}</b>
        </div>
        <div className="max-w-[62ch] pt-4 font-sans text-[14px]/[22px] text-ink">
          {paragraphs.map((p, i) => (
            <p key={i} className="mb-2.5 last:mb-0">
              {p}
            </p>
          ))}
        </div>
      </article>

      <aside className="flex min-w-0 flex-col gap-4">
        <section className="cb-doc" aria-labelledby="sorting-head">
          <div className="cb-doc-head">
            <span id="sorting-head">How hold sorted it</span>
            <StatusMark status={mark.status}>{toBill ? "Bill" : mark.label}</StatusMark>
          </div>
          <div className="p-4">
            <p className="font-mono text-[13px]/[20px] text-ink">
              Sorted as {t.kindName}: {t.why}
            </p>
            {t.quote ? <div className="cb-quote cb-micro">&ldquo;{t.quote}&rdquo;</div> : null}
            <p className="mt-3 border-t border-dashed border-line pt-3 font-mono text-[12px]/[18px] text-ink-muted">
              {t.correctedRoute ? (
                <>
                  hold had it as {ROUTE_WORDS[t.route]}. {corrector ? <Person name={PERSON_NAME[corrector]} /> : "A person"} said it&rsquo;s {ROUTE_WORDS[t.correctedRoute]}.
                </>
              ) : (
                <>{capitalise(ROUTE_WORDS[t.route])}.</>
              )}
            </p>
          </div>
        </section>

        {toBill ? (
          <section className="cb-doc p-4" aria-live="polite">
            {bill ? (
              <div className="flex flex-col items-start gap-2">
                <p className="font-mono text-[13px]/[20px] text-ink">hold ran the bill checks and made a bill from it.</p>
                <Cite href={`/bills/${encodeURIComponent(bill.key)}`}>INV-{bill.invoiceNo} · {bill.status}</Cite>
              </div>
            ) : (
              <p className="font-mono text-[13px]/[20px] text-graphite" role="status">
                <span className="cb-dots">hold is running the bill checks</span>
              </p>
            )}
          </section>
        ) : null}

        {timeline.length > 0 ? (
          <section className="cb-doc">
            <div className="cb-doc-head">
              Timeline
              <small>{timeline.length} {timeline.length === 1 ? "event" : "events"}</small>
            </div>
            <div role="list">
              {timeline.map((e) => (
                <LogEntry key={e.key} actor={ACTOR_NAME[e.actor]} agent={e.actor === "callback"} time={formatDateTime(e.at)} why={e.why}>
                  {e.what}
                </LogEntry>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

export function MessageView({ emailKey, actor }: { emailKey: string; actor: Actor }): React.ReactElement {
  return (
    <LoadBoundary what="this message">
      <View emailKey={emailKey} actor={actor} />
    </LoadBoundary>
  );
}
