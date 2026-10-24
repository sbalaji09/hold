"use client";
// hold's question for a person during a check call (voice/src/call/outbound.ts checkWithPerson).
// The supplier is on hold while this shows; the first person to answer decides the answer.
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/callback";
import { person } from "@/lib/company";
import { useCompany } from "@/lib/useCompany";
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

export function AskPerson({ ask, callId, actor }: { ask: AskEvent; callId: string; actor: "maya" | "dev" }) {
  const answer = useAnswerAsk();
  const who = person(useCompany(), actor);
  const now = useNow(true);
  const [step, setStep] = useState<"idle" | "follow_up" | "sending">("idle");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const left = Math.max(0, Math.ceil((ask._creationTime + WAIT_MS - now) / 1000));

  useEffect(() => {
    if (step === "follow_up") inputRef.current?.focus();
  }, [step]);

  const send = async (verdict: AskVerdict) => {
    setStep("sending");
    setError(null);
    try {
      await answer({ callId, askId: ask.ask_id, verdict, actor, ...(verdict === "follow_up" ? { followUp } : {}) });
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "That didn't reach hold. Try again.");
      setStep(verdict === "follow_up" ? "follow_up" : "idle");
    }
  };

  return (
    <section className="cb-doc hv-ask" aria-labelledby="hv-ask-title" role="alertdialog">
      <div className="cb-doc-head">
        <span id="hv-ask-title">{AGENT} is checking with you</span>
        <small role="timer" aria-live="off">
          {left > 0 ? `${left}s` : "Deciding"}
        </small>
      </div>
      <div className="hv-pad hv-ask-body">
        <p className="hv-statement">
          The supplier is on hold. {AGENT} couldn&apos;t tell whether this answer matches the records.
        </p>
        <dl className="hv-ask-facts">
          <dt className="cb-caps">Asked</dt>
          <dd className="hv-statement">{ask.ask}</dd>
          <dt className="cb-caps">They said</dt>
          <dd className="hv-quote">&ldquo;{ask.answer}&rdquo;</dd>
          <dt className="cb-caps">On file</dt>
          <dd>
            <span className="hv-record">{ask.expected}</span> <span className="cb-cite">{citeLabel(ask.source)}</span>
          </dd>
        </dl>

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
              Question for {AGENT} to ask
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
                {step === "sending" ? "Sending" : "Ask it"}
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
                Ask a follow-up
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
          As <span className="hv-person">{who.full}</span>. No answer in 20 seconds and {AGENT} counts it as not matching.
        </p>
      </div>
    </section>
  );
}
