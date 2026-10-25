// Pure call-lifecycle rules shared by the Convex functions and the in-memory VoiceStore fake,
// so both behave the same. No Convex imports here.
import type { CallRequest, CallResult, InboundCallRecord, SupplierProfile } from "../../shared/contract.js";
import { capital, type Company } from "../../lib/company.js";

export const DEFAULT_RETRY_DELAY_MS = 120_000;
export const HANDOFF_NO_ANSWER_SUMMARY = "No answer after 2 attempts";
export const TAKEOVER_BEFORE_CONNECT_SUMMARY = "Taken over by the team before the call connected";
export const BANK_CHANGE_REASON = "Inbound caller asked to change bank details";
export const PAYMENT_REQUEST_REASON = "Inbound caller asked us to send money";
export const UNKNOWN_CALLER = "Unknown caller";

/** Delay before the one retry. Configurable through CALL_RETRY_DELAY_MS. */
export function retryDelayMs(raw: string | undefined): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETRY_DELAY_MS;
}

/** "2:15 PM" in Fogline's time zone (San Francisco). */
export function formatRetryAt(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function noAnswerHandoff(call_id: string): CallResult {
  return { call_id, outcome: "handed_off", evidence: [], summary: HANDOFF_NO_ANSWER_SUMMARY };
}

/** Terminal request statuses: nothing moves a request out of these. */
export function isClosed(status: CallRequest["status"]): boolean {
  return status === "done" || status === "handed_off";
}

/**
 * The call's result once the approver judged an answer that waited for review: the answer is theirs,
 * and the call is decided once nothing waits any more.
 */
export function reviewedResult(result: CallResult, ask_id: string, matches: boolean, co: Company): Pick<CallResult, "outcome" | "evidence" | "summary"> {
  const evidence = result.evidence.map((e) => {
    if (e.ask_id !== ask_id || !e.pending_review) return e;
    const { pending_review: _, ...rest } = e;
    return { ...rest, matches, decided_by: "dev" as const };
  });
  if (evidence.some((e) => e.pending_review)) return { outcome: "needs_review", evidence, summary: result.summary };
  const ask = result.evidence.find((e) => e.ask_id === ask_id)?.ask ?? "";
  if (evidence.every((e) => e.matches)) {
    return { outcome: "confirmed", evidence, summary: `${capital(co.payee).one} answered every question in line with our records. You confirmed the answer to "${ask}".` };
  }
  const misses = evidence.filter((e) => !e.matches).map((e) => `"${e.ask}"`);
  return { outcome: "not_confirmed", evidence, summary: `Answers didn't match our records for ${misses.join(" and ")}.` };
}

export function followUpCallId(inbound_call_id: string): string {
  return `call_fu_${inbound_call_id}`;
}

/**
 * Follow-up check call for an inbound bank-change or money request. A money request carries what
 * the caller asked, so the call asks the supplier about that claim.
 * Always dials the supplier's phone_on_file, never the caller's number.
 */
export function followUpRequest(record: InboundCallRecord, supplier: SupplierProfile, why?: string): CallRequest {
  const claim = !record.asked_bank_change ? record.payment_claim : undefined;
  const reason = [why ?? (claim ? PAYMENT_REQUEST_REASON : BANK_CHANGE_REASON)];
  if (record.claimed_identity && record.claimed_identity !== UNKNOWN_CALLER) {
    reason.push(`Caller said they were ${record.claimed_identity}`);
  }
  if (record.requested) reason.push(`Caller asked: ${record.requested}`);
  return {
    call_id: followUpCallId(record.call_id),
    bill_id: `inbound:${record.call_id}`,
    supplier_id: supplier.supplier_id,
    to_number: supplier.phone_on_file,
    number_source: "on_file",
    reason,
    status: "queued",
    mode: "live",
    attempt: 0,
    ...(claim ? { claim } : {}),
  };
}

/** CALLING_HOURS "8-18" -> weekdays 8:00 to 18:00 in the payee's time zone. Unset or malformed = any time. */
export function parseCallingHours(raw: string | undefined): { start: number; end: number } | null {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(raw ?? "");
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start < end && end <= 24 ? { start, end } : null;
}

function localClock(ms: number, timeZone: string): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")) };
}

const isOpen = (ms: number, timeZone: string, h: { start: number; end: number }) => {
  const { weekday, hour } = localClock(ms, timeZone);
  return weekday !== "Sat" && weekday !== "Sun" && hour >= h.start && hour < h.end;
};

/**
 * When a live check call may be placed: null if now is inside the payee's calling hours, else the
 * next weekday opening. Nobody's phone rings at 2 AM because a scam email arrived at 2 AM.
 */
export function nextCallingTime(nowMs: number, timeZone: string, hours: { start: number; end: number } | null): number | null {
  if (!hours || isOpen(nowMs, timeZone, hours)) return null;
  // ponytail: hour-by-hour scan, at most four days (a long weekend); zones with half-hour offsets open on the hour mark.
  const HOUR = 3_600_000;
  for (let t = Math.ceil(nowMs / HOUR) * HOUR, i = 0; i < 96; t += HOUR, i++) if (isOpen(t, timeZone, hours)) return t;
  return null;
}

/** "Mon 8:00 AM" in the payee's time zone, for the Live call screen. */
export function formatCallingTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}
