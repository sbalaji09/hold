"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  CheckRow,
  Endorsement,
  Line,
  StatusMark,
} from "@/components/callback";
import {
  useActiveCall,
  useLiveCall,
  useRequestTakeover,
  useVoiceOnline,
  type CallRequestDoc,
  type CallResultDoc,
  type LiveCall,
} from "./api";
import {
  AGENT,
  buildTranscript,
  callTimes,
  callView,
  citeLabel,
  formatElapsed,
  formatPhone,
  formatTime,
  numberSourceLabel,
  type CallView,
} from "./format";
import { Transcript, type SourceHref } from "./Transcript";
import { waitingForReview } from "@/shared/contract";
import { AskPerson, openAsk } from "./AskPerson";
import { useCompany } from "@/lib/useCompany";
import "./voice.css";

export function liveCallPath(callId: string): string {
  return `/calls/${encodeURIComponent(callId)}`;
}

/**
 * Opens the Live call screen on its own when a call starts: navigates to `/calls/:id` once per
 * new active call. Mount it once in the app shell (see AutoOpenLiveCall).
 */
export function useAutoOpenLiveCall(): void {
  const active = useActiveCall();
  const router = useRouter();
  const pathname = usePathname();
  const opened = useRef(new Set<string>());
  const callId = active?.call_id;

  useEffect(() => {
    if (!callId || opened.current.has(callId)) return;
    opened.current.add(callId);
    const path = liveCallPath(callId);
    if (pathname !== path) router.push(path);
  }, [callId, pathname, router]);
}

/** Drop-in for a layout: `<AutoOpenLiveCall />`. */
export function AutoOpenLiveCall() {
  useAutoOpenLiveCall();
  return null;
}

/** Re-renders every second while `enabled`, for the elapsed clock. */
export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

export interface LiveCallScreenProps {
  callId: string;
  /** Link for a question's source record (`record_id`), once the app has record pages. */
  sourceHref?: SourceHref;
}

/** The Live call screen for `/calls/[callId]`. */
export function LiveCallScreen({
  callId,
  sourceHref,
}: LiveCallScreenProps) {
  const call = useLiveCall(callId);

  if (call === undefined) {
    return (
      <main className="hv-page">
        <p className="hv-empty">Loading the call.</p>
      </main>
    );
  }
  if (!call.request) {
    return (
      <main className="hv-page">
        <header className="hv-head">
          <div className="cb-caps">Live call</div>
          <h1 className="cb-subject">No call with this ID</h1>
          <p className="hv-sub">
            <span className="hv-record">{callId}</span> isn&apos;t in the call
            log. <Link href="/phone">Open the phone line</Link>.
          </p>
        </header>
      </main>
    );
  }
  return (
    <LiveCallView
      call={call}
      request={call.request}
      sourceHref={sourceHref}
    />
  );
}

function LiveCallView({
  call,
  request,
  sourceHref,
}: {
  call: LiveCall;
  request: CallRequestDoc;
  sourceHref?: SourceHref;
}) {
  const { record } = useCompany();
  const view = callView(call);
  const { startMs, endMs } = callTimes(call);
  const now = useNow(startMs !== null && endMs === null);
  const supplierName = call.supplier?.name || request.supplier_id;
  const contact = call.supplier?.contactName?.split(" ")[0];
  const otherName = contact ? `${contact} (${supplierName})` : supplierName;
  const rows = buildTranscript(call.events);
  const live = view.line === "connected" && view.active;
  const questions = call.events.flatMap((e) =>
    e.type === "question" ? [e.source] : []
  );
  const ask = view.active ? openAsk(call.events) : null;
  // After the call: an answer nobody judged in time waits for the approver here and on Today.
  const review = call.result?.outcome === "needs_review" ? waitingForReview(call.events)[0] ?? null : null;

  const online = useVoiceOnline();
  const offlineNotice = !online
    ? "The phone line is offline. hold can't place or answer calls until the voice server is running."
    : null;

  return (
    <main className="hv-page">
      <header className="hv-head">
        <div className="hv-head-text">
          <div className="cb-caps">
            Live call ·{" "}
            {request.mode === "simulated"
              ? "Practice, simulated supplier"
              : "outgoing check"}
          </div>
          <h1 className="cb-subject">{supplierName}</h1>
        </div>
      </header>

      <div className="hv-call">
        <div className="hv-call-main">
          <Line
            state={view.line}
            label={view.label}
            supplier={
              contact
                ? `${call.supplier?.contactName} · ${supplierName}`
                : supplierName
            }
            number={formatPhone(request.to_number)}
            source={numberSourceLabel(request.number_source)}
            elapsed={
              startMs === null
                ? undefined
                : formatElapsed((endMs ?? now) - startMs)
            }
            note={
              offlineNotice && request.status === "queued"
                ? offlineNotice
                : view.note
            }
          />
          <Takeover
            callId={request.call_id}
            view={view}
            takeoverRequested={!!request.takeover_requested}
          />
          {ask && (
            <AskPerson
              key={ask.ask_id}
              ask={ask}
              callId={request.call_id}
              partyName={contact || supplierName}
            />
          )}
          {review && (
            <AskPerson
              key={review.ask_id}
              ask={review}
              callId={request.call_id}
              review
            />
          )}
          <Transcript
            large
            done={!view.active}
            rows={rows}
            otherName={otherName}
            live={live}
            sourceHref={sourceHref}
            empty={
              view.line === "ringing" && request.status !== "queued"
                ? `Ringing ${formatPhone(request.to_number)}.`
                : view.line === "connected" && view.active
                ? "Connected. Waiting for the first words."
                : view.active
                ? "The transcript appears here once someone answers."
                : "Nothing was said on this call."
            }
          />
        </div>

        <aside className="hv-side">
          {call.result && <Result result={call.result} />}

          <section className="cb-doc hv-pad">
            <div className="cb-caps">Why {AGENT} is calling</div>
            <ul className="hv-reasons">
              {request.reason.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="cb-caps hv-mt">Why this number</div>
            <p className="hv-small">
              {formatPhone(request.to_number)} is{" "}
              {numberSourceLabel(request.number_source)}. {AGENT} never dials a
              number from the email.
            </p>
            {questions.length > 0 && (
              <>
                <div className="cb-caps hv-mt">Questions come from</div>
                <div className="hv-cites">
                  {questions.map((source, i) => {
                    const href = sourceHref?.(source);
                    return href ? (
                      <a key={i} className="cb-cite" href={href}>
                        {citeLabel(source, record)}
                      </a>
                    ) : (
                      <span key={i} className="cb-cite">
                        {citeLabel(source, record)}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function Takeover({
  callId,
  view,
  takeoverRequested,
}: {
  callId: string;
  view: CallView;
  takeoverRequested: boolean;
}) {
  const requestTakeover = useRequestTakeover();
  const [step, setStep] = useState<"idle" | "confirm" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (step === "confirm") confirmRef.current?.focus();
  }, [step]);

  if (!view.active) {
    return (
      <div className="hv-actions">
        <Button
          locked={
            takeoverRequested
              ? "You have this call now."
              : "The call has ended. There is nothing to take over."
          }
        >
          End call and take over
        </Button>
      </div>
    );
  }

  if (step === "idle") {
    return (
      <div className="hv-actions">
        <Button icon="person" onClick={() => setStep("confirm")}>
          End call and take over
        </Button>
        {error && (
          <p className="hv-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  const confirm = async () => {
    setStep("sending");
    setError(null);
    try {
      await requestTakeover(callId);
    } catch {
      setError("The call didn't end. Try again.");
    }
    setStep("idle");
  };

  return (
    <div
      className="hv-actions hv-confirm"
      role="group"
      aria-label="Confirm take over"
    >
      <p className="hv-small">
        {AGENT} hangs up and the call comes to you.
      </p>
      <div className="hv-confirm-buttons">
        <Button
          ref={confirmRef}
          variant="primary"
          onClick={confirm}
          disabled={step === "sending"}
        >
          {step === "sending" ? "Ending call" : "End call"}
        </Button>
        <Button onClick={() => setStep("idle")} disabled={step === "sending"}>
          Keep listening
        </Button>
      </div>
    </div>
  );
}

function Result({ result }: { result: CallResultDoc }) {
  const { record } = useCompany();
  const at = `${formatTime(result._creationTime)} · ${AGENT}`;
  return (
    <section className="cb-doc" aria-labelledby="hv-result-title">
      <div className="cb-doc-head">
        <span id="hv-result-title">Result</span>
        {result.evidence.length > 0 && (
          <small>
            {result.evidence.length}{" "}
            {result.evidence.length === 1 ? "answer" : "answers"}
          </small>
        )}
      </div>
      <div className="hv-pad">
        {result.outcome === "handed_off" || result.outcome === "needs_review" ? (
          <StatusMark status="needs-you" />
        ) : (
          <Endorsement
            kind={result.outcome === "confirmed" ? "confirmed" : "held"}
            meta={at}
          >
            {result.outcome === "confirmed"
              ? "Confirmed by call"
              : "Not confirmed"}
          </Endorsement>
        )}
        <p className="hv-statement">{result.summary}</p>
      </div>
      {result.evidence.length > 0 && (
        <div role="list" aria-label="Answers checked against the records">
          {result.evidence.map((item, i) => (
            <CheckRow
              key={i}
              n={i + 1}
              result={item.pending_review ? "warn" : item.matches ? "pass" : "fail"}
              title={item.ask}
              evidence={
                <>
                  {item.pending_review ? (
                    "Waiting for your review."
                  ) : item.matches ? (
                    <span className="hv-quote">“{item.answer}”</span>
                  ) : (
                    "Doesn't match the records."
                  )}
                  {item.decided_by && <DecidedBy matches={item.matches} />}
                </>
              }
              quote={item.matches ? undefined : item.answer}
              sources={
                item.source ? [citeLabel(item.source, record)] : undefined
              }
            />
          ))}
        </div>
      )}
      {result.recording_url && (
        <Recording url={result.recording_url} clip={result.clip} />
      )}
    </section>
  );
}

/** The approver judged this answer during the call; hold's own judgment didn't decide it. */
function DecidedBy({ matches }: { matches: boolean }) {
  return (
    <span className="hv-small">
      {" "}
      Judged {matches ? "a match" : "not a match"} by you.
    </span>
  );
}

export function Recording({
  url,
  clip,
}: {
  url: string;
  clip?: CallResultDoc["clip"];
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);

  const playClip = () => {
    const el = audio.current;
    if (!el || !clip) return;
    stopAt.current = clip.end_s;
    el.currentTime = clip.start_s;
    void el.play();
  };

  return (
    <div className="hv-recording">
      <div className="cb-caps">Recording</div>
      <audio
        ref={audio}
        src={url}
        controls
        preload="metadata"
        aria-label="Call recording"
        onTimeUpdate={(e) => {
          if (
            stopAt.current !== null &&
            e.currentTarget.currentTime >= stopAt.current
          ) {
            e.currentTarget.pause();
            stopAt.current = null;
          }
        }}
        onSeeking={(e) => {
          // A manual seek outside the clip means the listener wants the whole recording.
          const t = e.currentTarget.currentTime;
          if (clip && (t < clip.start_s || t > clip.end_s))
            stopAt.current = null;
        }}
      />
      {clip && (
        <Button size="sm" onClick={playClip}>
          Play key sentence {formatElapsed(clip.start_s * 1000)}-
          {formatElapsed(clip.end_s * 1000)}
        </Button>
      )}
    </div>
  );
}
