"use client";
import Link from "next/link";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, CheckRow, Line, StatusMark } from "@/components/callback";
import { useCompany } from "@/lib/useCompany";
import { useLiveCall, usePhoneLine, useReportCall, useSupplierName, useTacticNames, type CallVerdict, type InboundCallDoc, type OutgoingCall } from "./api";
import { AGENT, buildTranscript, callView, formatElapsed, formatPhone, formatWhen, parseTime, type TranscriptRow } from "./format";
import { liveCallPath, Recording, useNow } from "./LiveCall";
import { Transcript } from "./Transcript";
import "./voice.css";

function rows(call: InboundCallDoc): TranscriptRow[] {
  return call.transcript.map((line, i) => ({ key: String(i), speaker: line.speaker, text: line.text, ts: line.ts }));
}

function who(call: InboundCallDoc): string {
  return call.claimed_identity ? `Says ${call.claimed_identity}` : "Unknown caller";
}



/** How long after a call ends hold is still expected to be screening it. */
const SCREENING_MS = 3 * 60_000;

type Screen = "flag" | "pass" | "screening" | "silent" | "unscreened";

/** Where a past call stands against the playbook. */
function screenState(call: InboundCallDoc, now: number): Screen {
  if (call.fraud) return call.fraud.state;
  if (!call.transcript.some((t) => t.speaker === "caller")) return "silent";
  const ended = parseTime(call.endedAt) ?? parseTime(call.receivedAt) ?? call._creationTime;
  return now - ended < SCREENING_MS ? "screening" : "unscreened";
}

/** The Phone line screen for `/phone`: the company's number, live incoming calls, past calls. `callId` opens that call. */
export function PhoneLineScreen({ callId }: { callId?: string }) {
  const line = usePhoneLine();
  const co = useCompany();

  if (line === undefined) {
    return (
      <main className="hv-page">
        <p className="hv-empty">Loading the phone line.</p>
      </main>
    );
  }

  const number = line.number ? formatPhone(line.number) : null;

  return (
    <main className="hv-page">
      <header className="hv-head">
        <div className="hv-head-text">
          <h1 className="cb-display">Phone line</h1>
          <p className="hv-sub">{co.owner} {co.team.replace(/ team$/, "")} line. {AGENT} answers every call and places every check call.</p>
        </div>
        <div className="hv-number">
          <div className="cb-caps">{co.owner} number</div>
          {line.number ? (
            <a className="hv-number-value" href={`tel:${line.number}`}>
              {number}
            </a>
          ) : (
            <p className="hv-small">No number is set up. Set TWILIO_PHONE_NUMBER in the Convex environment.</p>
          )}
        </div>
      </header>

      {line.active.map((call) => (
        <ActiveCall key={call._id} call={call} />
      ))}

      <div className="hv-phone">
        <PastCalls calls={line.past} outgoing={line.outgoing} number={number} callId={callId} />
      </div>
    </main>
  );
}

function ActiveCall({ call }: { call: InboundCallDoc }) {
  const now = useNow(true);
  const started = parseTime(call.receivedAt) ?? call._creationTime;
  return (
    <section className="hv-call-main hv-inbound" aria-label={`Call from ${formatPhone(call.caller_number)}`}>
      <Line
        state="connected"
        supplier={who(call)}
        number={formatPhone(call.caller_number)}
        source="incoming"
        elapsed={formatElapsed(now - started)}
        note={call.asked_bank_change ? `Asked to change bank details. Nothing changes from this call; ${AGENT} calls the supplier back on the number on file.` : undefined}
      />
      <Transcript large rows={rows(call)} otherName="Caller" live empty="Answering." />
    </section>
  );
}

type Item = { dir: "in"; call: InboundCallDoc; at: number } | { dir: "out"; call: OutgoingCall; at: number };

function PastCalls({ calls, outgoing, number, callId }: { calls: InboundCallDoc[]; outgoing: OutgoingCall[]; number: string | null; callId?: string }) {
  const co = useCompany();
  // The open call is tracked by call_id so links from the Activity log (/phone?call=in_...) land on it.
  const [openId, setOpenId] = useState<string | null>(callId ?? null);
  // Ticks so a just-ended call moves from "Screening" to its verdict (or to unscreened) without a reload.
  const now = useNow(calls.some((c) => screenState(c, Date.now()) === "screening"));
  // Incoming and outgoing calls in one list, newest first.
  const items: Item[] = [
    ...calls.map((call): Item => ({ dir: "in", call, at: parseTime(call.receivedAt) ?? call._creationTime })),
    ...outgoing.map((call): Item => ({ dir: "out", call, at: call.at })),
  ].sort((a, b) => b.at - a.at);
  const openItem = items.find((i) => i.call.call_id === openId) ?? items[0];
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (callId && items.some((i) => i.call.call_id === callId)) detailRef.current?.scrollIntoView({ block: "start" });
    // Only on arrival from a link, not on every live update.
  }, [callId]);

  if (!openItem) {
    return (
      <section className="cb-doc">
        <div className="cb-doc-head">Calls</div>
        <p className="hv-empty">
          {number ? `No calls yet. ${co.owner} line is ${number}.` : "No calls yet."} Calls show up here as they happen.
        </p>
      </section>
    );
  }

  return (
    <div className="hv-past">
      <section className="cb-doc hv-list" aria-labelledby="hv-past-title">
        <div className="cb-doc-head">
          <span id="hv-past-title">Calls</span>
          <small>{items.length}</small>
        </div>
        {items.map((item) => {
          const on = item.call.call_id === openItem.call.call_id;
          return (
            <button
              key={item.call.call_id}
              type="button"
              className={`hv-row${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => setOpenId(item.call.call_id)}
            >
              <div className="hv-row-text">
                <div className="hv-strong">{item.dir === "in" ? who(item.call) : item.call.approval ? "Approval call to the approver" : `Check call to ${item.call.supplier}`}</div>
                <div className="cb-when">
                  {item.dir === "in" ? "Incoming" : "Outgoing"} · {item.dir === "out" && item.call.approval ? "" : `${formatPhone(item.dir === "in" ? item.call.caller_number : item.call.to_number)} · `}{formatWhen(item.at, now)}
                </div>
              </div>
              {item.dir === "in" ? <RowMark call={item.call} screen={screenState(item.call, now)} /> : <OutgoingMark call={item.call} />}
            </button>
          );
        })}
      </section>

      {openItem.dir === "out" ? (
        <OutgoingDetail key={openItem.call.call_id} ref={detailRef} call={openItem.call} />
      ) : (
        <IncomingDetail ref={detailRef} open={openItem.call} now={now} />
      )}
    </div>
  );
}

function IncomingDetail({ open, now, ref }: { open: InboundCallDoc; now: number; ref: React.Ref<HTMLElement> }) {
  return (
    <section ref={ref} className="cb-doc hv-detail" aria-label="Call transcript">
      <div className="cb-doc-head">
        <span>{who(open)}</span>
        <small>{formatPhone(open.caller_number)}</small>
      </div>
      <div className="hv-pad hv-detail-meta">
        <div>
          <div className="cb-caps">Asked for</div>
          <p>{open.requested || "Nothing specific."}</p>
        </div>
        <div>
          <div className="cb-caps">Follow-up</div>
          {open.triggered_call_id ? <CheckCall call={open} /> : <p className="hv-small">None needed.</p>}
        </div>
      </div>
      <Verdict key={`verdict-${open._id}`} call={open} screen={screenState(open, now)} />
      <Transcript key={open._id} rows={rows(open)} otherName="Caller" live={false} empty="No transcript was saved for this call." />
      {open.recording_url && (
        <div className="hv-pad">
          <Recording key={open._id} url={open.recording_url} />
        </div>
      )}
    </section>
  );
}

/** Where an outgoing check call stands, in the system's six status words. */
function OutgoingMark({ call }: { call: OutgoingCall }) {
  if (call.approval) {
    if (call.outcome === "confirmed") return <StatusMark status="paid">Approved</StatusMark>;
    if (call.outcome === "not_confirmed") return <StatusMark status="held">Denied</StatusMark>;
    if (call.outcome) return <StatusMark status="needs-you">No decision</StatusMark>;
    return <StatusMark status="calling">Asking approver</StatusMark>;
  }
  if (call.outcome === "confirmed") return <StatusMark status="paid">Confirmed</StatusMark>;
  if (call.outcome === "not_confirmed") return <StatusMark status="held">Not confirmed</StatusMark>;
  if (call.outcome === "needs_review" && !call.review_open) return <StatusMark status="paid">Called back</StatusMark>;
  if (call.outcome) return <StatusMark status="needs-you">{call.outcome === "needs_review" ? "Needs your review" : "Handed off"}</StatusMark>;
  return <StatusMark status="calling">{call.status === "retry_scheduled" ? "Calling again" : "Calling"}</StatusMark>;
}

/** An outgoing check call: what hold found, the transcript and recording, and the full call page. */
function OutgoingDetail({ call, ref }: { call: OutgoingCall; ref: React.Ref<HTMLElement> }) {
  const live = useLiveCall(call.call_id);
  const view = live ? callView(live) : null;
  const result = live?.result;
  return (
    <section ref={ref} className="cb-doc hv-detail" aria-label="Call transcript">
      <div className="cb-doc-head">
        <span>{call.approval ? "Approval call to the approver" : `Check call to ${call.supplier}`}</span>
        <small>{formatPhone(call.to_number)}</small>
      </div>
      <div className="hv-pad hv-detail-meta">
        <div>
          <div className="cb-caps">Why {AGENT} called</div>
          <p>{live?.request?.reason.join(" · ") || "Checking a bill."}</p>
        </div>
        <div>
          <div className="cb-caps">Result</div>
          <p>{result ? result.summary : view?.note ?? "Still on the line."}</p>
          <p>
            <Link href={liveCallPath(call.call_id)}>Open the call</Link>
          </p>
        </div>
      </div>
      <Transcript
        rows={live ? buildTranscript(live.events) : []}
        otherName={call.supplier}
        live={Boolean(view?.active)}
        empty={live === undefined ? "Loading the transcript." : "Nothing was said on this call."}
      />
      {result?.recording_url && (
        <div className="hv-pad">
          <Recording url={result.recording_url} clip={result.clip} />
        </div>
      )}
    </section>
  );
}

function RowMark({ call, screen }: { call: InboundCallDoc; screen: Screen }) {
  if (screen === "flag") return <StatusMark status="held">Flagged</StatusMark>;
  if (screen === "screening") return <StatusMark status="checking">Screening</StatusMark>;
  if (isApproval(call)) {
    if (call.approval_decision === "approved") return <StatusMark status="paid">Approved</StatusMark>;
    if (call.approval_decision === "denied") return <StatusMark status="held">Denied</StatusMark>;
    if (call.approval_decision === "no_decision") return <StatusMark status="needs-you">No decision</StatusMark>;
    return <StatusMark status="calling">Asking approver</StatusMark>;
  }
  if (call.triggered_call_id) return <StatusMark status="held">Called back on file</StatusMark>;
  return <StatusMark status="paid">Answered</StatusMark>;
}

const isApproval = (call: InboundCallDoc) => call.triggered_call_id?.startsWith("approval_") ?? false;

const DECIDED = { approved: "The approver approved it.", denied: "The approver denied it.", no_decision: "The approver gave no clear answer, so it stays unapproved." } as const;

/** The outgoing check call hold booked to the supplier's number on file, or the call asking the approver. */
function CheckCall({ call }: { call: InboundCallDoc }) {
  const supplier = useSupplierName(call.claimed_supplier_id);
  if (isApproval(call)) {
    return (
      <>
        <p className="hv-followup">
          {call.approval_decision ? DECIDED[call.approval_decision] : `${AGENT} has no record of this caller's company, so it's asking the approver to approve or deny.`}
        </p>
        <p>
          <Link href={liveCallPath(call.triggered_call_id!)}>Open the approval call</Link>
        </p>
      </>
    );
  }
  return (
    <>
      <p className="hv-followup">
        {AGENT} is calling {supplier ?? "the supplier"} back on the number on file.
      </p>
      <p>
        <Link href={liveCallPath(call.triggered_call_id!)}>Open the check call</Link>
      </p>
    </>
  );
}

/** hold's playbook verdict on a past call, and the person's say on it. */
function Verdict({ call, screen }: { call: InboundCallDoc; screen: Screen }) {
  const tactics = useTacticNames();
  const fraud = call.fraud;
  let body: ReactNode;
  if (screen === "screening") {
    body = (
      <p className="hv-statement hv-graphite" role="status">
        <span className="cb-dots">Screening against the playbook</span>
      </p>
    );
  } else if (fraud) {
    const named = fraud.techniqueKeys.flatMap((k) => (tactics?.[k] ? [tactics[k]] : []));
    body = (
      <div role="list" className="hv-check">
        <CheckRow
          result={fraud.state === "flag" ? "fail" : "pass"}
          title={fraud.state === "flag" ? (named.length ? `Flagged: ${named.join("; ")}` : "Flagged as a suspicious call") : "Screened against the playbook"}
          evidence={fraud.evidence}
          quote={fraud.quote}
        />
      </div>
    );
  } else {
    body = (
      <p className="hv-small">
        {screen === "silent" ? "The caller didn't speak, so there was nothing to screen." : "This call wasn't screened against the playbook."}
      </p>
    );
  }
  return (
    <div className="hv-pad hv-verdict" aria-label="Playbook check" role="group">
      <div className="cb-caps">Playbook</div>
      {body}
      {screen === "screening" ? null : <Report call={call} flagged={screen === "flag"} />}
    </div>
  );
}

const REPORT: Record<CallVerdict, { button: string; confirm: string; explain: string; sending: string }> = {
  scam: {
    button: "Report scam call",
    confirm: "Report it",
    sending: "Reporting",
    explain: `${AGENT} works out what it missed on this call and tests the fix against past calls before it goes live.`,
  },
  not_scam: {
    button: "Not a scam",
    confirm: "Clear it",
    sending: "Clearing",
    explain: `${AGENT} learns not to flag calls like this one. The check call still goes ahead.`,
  },
};

function Report({ call, flagged }: { call: InboundCallDoc; flagged: boolean }) {
  const report = useReportCall();
  const verdict: CallVerdict = flagged ? "not_scam" : "scam";
  const words = REPORT[verdict];
  const [step, setStep] = useState<"idle" | "confirm" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (done) {
    return (
      <p className="hv-small" role="status">
        {done}
      </p>
    );
  }

  if (!call.transcript.some((t) => t.speaker === "caller")) {
    return (
      <div className="hv-report">
        <Button size="sm" locked="The caller never spoke, so there is nothing for hold to learn from.">
          {words.button}
        </Button>
      </div>
    );
  }

  const cancel = () => {
    setStep("idle");
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const confirm = async () => {
    setStep("sending");
    setError(null);
    try {
      const r = await report(call.call_id, verdict);
      setDone(
        r.key
          ? `${AGENT} is learning from this call.`
          : `${AGENT} is already learning from this call.`,
      );
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Couldn't send that just now. Try again.");
      setStep("confirm");
    }
  };

  if (step === "idle") {
    return (
      <div className="hv-report">
        <Button ref={triggerRef} size="sm" onClick={() => setStep("confirm")}>
          {words.button}
        </Button>
      </div>
    );
  }

  return (
    <div className="hv-report hv-confirm" role="group" aria-label={words.button} onKeyDown={(e) => e.key === "Escape" && cancel()}>
      <p className="hv-small">{words.explain}</p>
      {error && (
        <p className="hv-error" role="alert">
          {error}
        </p>
      )}
      <div className="hv-confirm-buttons">
        <Button size="sm" variant="primary" onClick={confirm} disabled={step === "sending"} autoFocus>
          {step === "sending" ? `${words.sending}…` : words.confirm}
        </Button>
        <Button size="sm" onClick={cancel} disabled={step === "sending"}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
