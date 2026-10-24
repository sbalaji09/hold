// Pure display helpers for the voice screens. No React, no Convex, so they are easy to test.
import type { NumberSource, Speaker } from "@/shared/contract";
import type { CallEventDoc, LiveCall } from "./api";

/** Fogline is in San Francisco; the voice server formats retry times in the same zone. */
export const TIME_ZONE = "America/Los_Angeles";

/** The agent's name on screen and in transcripts. */
export const AGENT = "hold";

/** Who a handed-off call goes to. */
export const HANDOFF_TO = "Maya";

export type LineState = "ringing" | "connected" | "no-answer" | "dropped" | "confirmed" | "not-confirmed";

type Source = { kind: string; ref: string; record_id?: string };

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });

/** "2:15 PM" */
export function formatTime(ms: number): string {
  return timeFmt.format(new Date(ms));
}

/** "Today 2:15 PM", "Yesterday 4:05 PM", otherwise "Oct 21, 2:15 PM". */
export function formatWhen(ms: number, nowMs: number): string {
  const day = dayFmt.format(new Date(ms));
  if (day === dayFmt.format(new Date(nowMs))) return `Today ${formatTime(ms)}`;
  if (day === dayFmt.format(new Date(nowMs - 86_400_000))) return `Yesterday ${formatTime(ms)}`;
  return `${day}, ${formatTime(ms)}`;
}

/** Call timecode: "00:07", "12:30", "1:02:03". Negative input counts as 0. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** "+14155550142" -> "(415) 555-0142". Anything that isn't a US E.164 number is shown as given. */
export function formatPhone(number: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : number;
}

export function numberSourceLabel(source: NumberSource): string {
  return source === "on_file" ? "on file" : "from background check";
}

/** Cite label: "Invoice #4471". Refs that already name their kind ("Email 12 Sep") are used as they are. */
export function citeLabel(source: Source): string {
  const ref = source.ref.trim();
  if (ref.toLowerCase().startsWith(source.kind.toLowerCase())) return ref.charAt(0).toUpperCase() + ref.slice(1);
  return `${source.kind.charAt(0).toUpperCase()}${source.kind.slice(1)} ${ref}`;
}

/** Parse an ISO timestamp from the app's tables; null when absent or invalid. */
export function parseTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export interface CallView {
  line: LineState;
  /** Overrides the Line's default state word. */
  label?: string;
  /** The status in plain words, including the unhappy paths. */
  note?: string;
  /** The call can still be ended and taken over. */
  active: boolean;
}

type StatusEvent = Extract<CallEventDoc, { type: "status" }>;

function statusEvents(events: CallEventDoc[]): StatusEvent[] {
  return events.filter((e): e is StatusEvent => e.type === "status");
}

/** When the call was answered and (if over) when it ended, for the elapsed clock. */
export function callTimes(call: LiveCall): { startMs: number | null; endMs: number | null } {
  const statuses = statusEvents(call.events);
  const answered = statuses.find((e) => e.value === "in_progress");
  const startMs = parseTime(call.request?.startedAt) ?? answered?._creationTime ?? null;
  const over = statuses.filter((e) => e.value === "ended" || e.value === "dropped").at(-1);
  const endMs = over?._creationTime ?? call.result?._creationTime ?? null;
  return { startMs, endMs };
}

/** What the Line on the Live call screen shows. */
export function callView(call: LiveCall): CallView {
  const { request, result } = call;
  const statuses = statusEvents(call.events);
  const last = statuses.at(-1);
  const dropped = statuses.filter((e) => e.value === "dropped").at(-1);
  const answered = statuses.some((e) => e.value === "in_progress");
  const { startMs } = callTimes(call);
  const droppedNote = dropped
    ? `Line dropped${startMs !== null ? ` at ${formatElapsed(dropped._creationTime - startMs)}` : ""}.`
    : "";

  const handoff = (): CallView => {
    if (request?.takeover_requested) return { line: "dropped", label: "Taken over", note: `${HANDOFF_TO} took over the call.`, active: false };
    if (dropped) return { line: "dropped", note: `${droppedNote} Handed off to ${HANDOFF_TO}.`, active: false };
    if (!answered && statuses.some((e) => e.value === "no_answer")) {
      return { line: "no-answer", note: `No answer after the retry. Handed off to ${HANDOFF_TO}.`, active: false };
    }
    return { line: "dropped", label: "Handed off", note: `Handed off to ${HANDOFF_TO}.`, active: false };
  };

  if (result) {
    if (result.outcome === "confirmed") return { line: "confirmed", active: false };
    if (result.outcome === "not_confirmed") return { line: "not-confirmed", active: false };
    return handoff();
  }
  if (!request) return { line: "dropped", label: "Not found", active: false };

  switch (request.status) {
    case "queued":
      return (request.attempt ?? 0) > 0
        ? { line: "ringing", label: "Calling again", note: "Dialing the retry now.", active: true }
        : { line: "ringing", label: "Dialing", note: "Getting ready to call.", active: true };
    case "dialing":
      return last?.value === "ringing" ? { line: "ringing", active: true } : { line: "ringing", label: "Dialing", active: true };
    case "in_progress":
      if (request.takeover_requested) return { line: "connected", label: "Ending call", note: `Ending the call for ${HANDOFF_TO}.`, active: false };
      if (last?.value === "dropped") return { line: "dropped", note: droppedNote, active: false };
      return { line: "connected", active: true };
    case "retry_scheduled": {
      const retryEvent = statuses.filter((e) => e.value === "retry_scheduled").at(-1);
      const retryMs = retryEvent?.retry_at_ms ?? request.retry_at_ms;
      const at = retryEvent?.retry_at ?? (retryMs !== undefined ? formatTime(retryMs) : undefined);
      return { line: "no-answer", note: at ? `No answer. Trying again at ${at}.` : "No answer. Trying again shortly.", active: true };
    }
    case "done":
      return { line: "confirmed", label: "Call ended", note: "Checking the answers against the records.", active: false };
    case "handed_off":
      return handoff();
  }
}

export interface TranscriptRow {
  key: string;
  speaker: Speaker;
  text: string;
  /** Seconds from the start of the recording. */
  ts: number;
  /** Where the question in this line came from. */
  source?: Source;
}

/**
 * Transcript lines in order. A `question` event becomes the cite of the agent line that speaks it
 * (the next segment, if that is the agent's). A question with no such line gets a row of its own.
 */
export function buildTranscript(events: CallEventDoc[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let pending: Extract<CallEventDoc, { type: "question" }> | null = null;
  let lastTs = 0;
  const flush = () => {
    if (pending) rows.push({ key: pending._id, speaker: "callback", text: pending.ask, ts: lastTs, source: pending.source });
    pending = null;
  };
  for (const e of events) {
    if (e.type === "question") {
      flush();
      pending = e;
    } else if (e.type === "segment") {
      if (pending && e.speaker === "callback") {
        rows.push({ key: e._id, speaker: e.speaker, text: e.text, ts: e.ts, source: pending.source });
        pending = null;
      } else {
        flush();
        rows.push({ key: e._id, speaker: e.speaker, text: e.text, ts: e.ts });
      }
      lastTs = e.ts;
    }
  }
  flush();
  return rows;
}
