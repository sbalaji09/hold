"use client";
// hold's question for a person during a check call (voice/src/call/outbound.ts checkWithPerson).
// The supplier is on hold while this shows; the first person to answer decides the answer.
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/callback";
import { useAnswerAsk, type AskVerdict, type CallEventDoc } from "./api";
import { AGENT, citeLabel } from "./format";
import { useNow } from "./LiveCall";

type AskEvent = Extract<CallEventDoc, { type: "ask_person" }>;

/** Matches OUTBOUND_LIMITS.personTimeoutMs on the voice server; only drives the countdown. */
const WAIT_MS = 20_000;

/** The question still waiting on a person, if any: an ask_person event with no reply yet. */
export function openAsk(events: CallEventDoc[]): AskEvent | null {
  const replied = new Set(events.flatMap((e) => (e.type === "person_answer" ? [e.ask_id] : [])));
  const asks = events.filter((e): e is AskEvent => e.type === "ask_person" && !replied.has(e.ask_id));
  return asks[asks.length - 1] ?? null;
}

/**
 * `review`: the call is over and nobody answered in time (or the approver was away), so the answer
 * waits here and on Today. No countdown; a question makes hold call back on the number on file.
 */
export function AskPerson({
  ask,
  callId,
  partyName,
  review = false,
}: {
  ask: AskEvent;
  callId: string;
  partyName?: string;
  review?: boolean;
}) {
  const answer = useAnswerAsk();
  const now = useNow(!review);
  const [step, setStep] = useState<"idle" | "follow_up" | "sending">("idle");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deadline = ask._creationTime + WAIT_MS;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const fraction = Math.max(0, Math.min(1, (deadline - now) / WAIT_MS));
  const party = partyName || "The supplier";

  useEffect(() => {
    if (step === "follow_up") inputRef.current?.focus();
  }, [step]);

  const send = async (verdict: AskVerdict) => {
    setStep("sending");
    setError(null);
    try {
      await answer({ callId, askId: ask.ask_id, verdict, ...(verdict === "follow_up" ? { followUp } : {}) });
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "That didn't reach hold. Try again.");
      setStep(verdict === "follow_up" ? "follow_up" : "idle");
    }
  };

  return (
    <section className="cb-doc hv-ask" aria-labelledby="hv-ask-title" role={review ? "region" : "alertdialog"}>
      {review ? null : (
        <div className="hv-ask-bar" aria-hidden="true">
          <div className="hv-ask-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
        </div>
      )}
      <div className="hv-ask-head">
        <h2 id="hv-ask-title" className="hv-ask-title">
          {review ? "Check this answer" : `${AGENT} needs you · ${party} is on hold`}
        </h2>
        <p className="hv-ask-timer" role={review ? undefined : "timer"} aria-live="off">
          {review
            ? `${AGENT} couldn't tell whether this answer matches the records, and nobody was free to check it during the call.`
            : left > 0
              ? `${left}s to answer`
              : "Time's up. It waits for your review after the call."}
        </p>
      </div>
      <div className="hv-pad hv-ask-body">
        <p className="hv-ask-question">{ask.ask}</p>
        <div className="hv-ask-compare">
          <div className="hv-ask-col">
            <div className="cb-caps">They said</div>
            <div className="hv-ask-said">&ldquo;{ask.answer}&rdquo;</div>
          </div>
          <div className="hv-ask-col">
            <div className="cb-caps">On file</div>
            <div className="hv-ask-file">{ask.expected}</div>
            <span className="cb-cite">{citeLabel(ask.source)}</span>
          </div>
        </div>
        {ask.closest ? (
          <p className="hv-small">
            Sounds like <span className="hv-record">{ask.closest}</span>
          </p>
        ) : null}

        {step === "follow_up" || (step === "sending" && followUp) ? (
          <form
            className="hv-ask-follow"
            onSubmit={(e) => {
              e.preventDefault();
              void send("follow_up");
            }}
            onKeyDown={(e) => e.key === "Escape" && setStep("idle")}
          >
            <label className="cb-caps" htmlFor="hv-ask-input">
              {review ? `Question for ${AGENT} to ask when it calls back` : `Question for ${AGENT} to ask`}
            </label>
            <input
              id="hv-ask-input"
              ref={inputRef}
              className="pt-input"
              value={followUp}
              maxLength={200}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="What was that invoice for?"
            />
            <div className="hv-confirm-buttons">
              <Button type="submit" variant="primary" size="sm" disabled={step === "sending" || !followUp.trim()}>
                {step === "sending" ? "Sending" : review ? "Call back and ask" : "Ask it"}
              </Button>
              <Button type="button" size="sm" onClick={() => setStep("idle")} disabled={step === "sending"}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="hv-confirm-buttons hv-wrap">
            <Button variant="primary" onClick={() => send("matches")} disabled={step === "sending"}>
              Matches
            </Button>
            <Button onClick={() => send("no_match")} disabled={step === "sending"}>
              Doesn&apos;t match
            </Button>
            {ask.follow_up_allowed ? (
              <Button onClick={() => setStep("follow_up")} disabled={step === "sending"}>
                {review ? "Call back with a question" : "Ask a follow-up"}
              </Button>
            ) : (
              <Button locked={`${AGENT} already asked one follow-up. Say whether this answer matches.`}>Ask a follow-up</Button>
            )}
          </div>
        )}

        {error ? (
          <p className="hv-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="hv-small">
          {review
            ? `Matches or Doesn't match decides the bill. A question makes ${AGENT} call back on the number on file and bring the answer here.`
            : `No answer in 20 seconds and it waits for your review after the call.`}
        </p>
      </div>
    </section>
  );
}
