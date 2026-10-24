"use client";
import Link from "next/link";
import { useState } from "react";
import { Line, StatusMark } from "@/components/callback";
import { CALLBACK_PROMISE } from "@/shared/contract";
import { usePhoneLine, type InboundCallDoc } from "./api";
import { AGENT, formatElapsed, formatPhone, formatWhen, parseTime, type TranscriptRow } from "./format";
import { liveCallPath, useNow } from "./LiveCall";
import { Transcript } from "./Transcript";
import "./voice.css";

function rows(call: InboundCallDoc): TranscriptRow[] {
  return call.transcript.map((line, i) => ({ key: String(i), speaker: line.speaker, text: line.text, ts: line.ts }));
}

function who(call: InboundCallDoc): string {
  return call.claimed_identity ? `Says ${call.claimed_identity}` : "Unknown caller";
}

/** The Phone line screen for `/phone`: Fogline's number, live incoming calls, past calls. */
export function PhoneLineScreen() {
  const line = usePhoneLine();

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
          <p className="hv-sub">Fogline&apos;s accounts line. {AGENT} answers every call.</p>
        </div>
        <div className="hv-number">
          <div className="cb-caps">Fogline&apos;s number</div>
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
        <PastCalls calls={line.past} number={number} />
        <section className="cb-doc hv-pad hv-rule">
          <div className="cb-caps">Rule</div>
          <p className="hv-statement">
            {AGENT} never changes bank details from an incoming call. It says &ldquo;{CALLBACK_PROMISE.replace(/\.$/, "")}&rdquo; and starts an
            outgoing check call to the number on file.
          </p>
        </section>
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

function PastCalls({ calls, number }: { calls: InboundCallDoc[]; number: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const now = Date.now();
  const open = calls.find((c) => c._id === openId) ?? calls[0];

  if (!open) {
    return (
      <section className="cb-doc">
        <div className="cb-doc-head">Incoming calls</div>
        <p className="hv-empty">
          {number ? `No calls yet. Fogline's line is ${number}.` : "No calls yet."} Calls show up here as they happen.
        </p>
      </section>
    );
  }

  return (
    <div className="hv-past">
      <section className="cb-doc hv-list" aria-labelledby="hv-past-title">
        <div className="cb-doc-head">
          <span id="hv-past-title">Incoming calls</span>
          <small>{calls.length}</small>
        </div>
        {calls.map((call) => (
          <button
            key={call._id}
            type="button"
            className={`hv-row${call._id === open._id ? " on" : ""}`}
            aria-pressed={call._id === open._id}
            onClick={() => setOpenId(call._id)}
          >
            <div className="hv-row-text">
              <div className="hv-strong">{who(call)}</div>
              <div className="cb-when">
                {formatPhone(call.caller_number)} · {formatWhen(parseTime(call.receivedAt) ?? call._creationTime, now)}
              </div>
            </div>
            {call.triggered_call_id ? <StatusMark status="held">Called back on file</StatusMark> : <StatusMark status="paid">Answered</StatusMark>}
          </button>
        ))}
      </section>

      <section className="cb-doc hv-detail" aria-label="Call transcript">
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
            {open.triggered_call_id ? (
              <p>
                <Link href={liveCallPath(open.triggered_call_id)}>Open the check call</Link>
              </p>
            ) : (
              <p className="hv-small">None needed.</p>
            )}
          </div>
        </div>
        <Transcript key={open._id} rows={rows(open)} otherName="Caller" live={false} empty="No transcript was saved for this call." />
      </section>
    </div>
  );
}
