// Pure call-lifecycle rules shared by the Convex functions and the in-memory VoiceStore fake,
// so both behave the same. No Convex imports here.
import type { CallRequest, CallResult, InboundCallRecord, SupplierProfile } from "../../shared/contract.js";

export const DEFAULT_RETRY_DELAY_MS = 120_000;
export const HANDOFF_NO_ANSWER_SUMMARY = "No answer after 2 attempts";
export const TAKEOVER_BEFORE_CONNECT_SUMMARY = "Taken over by the team before the call connected";
export const BANK_CHANGE_REASON = "Inbound caller asked to change bank details";
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

export function followUpCallId(inbound_call_id: string): string {
  return `call_fu_${inbound_call_id}`;
}

/**
 * Follow-up check call for an inbound bank-change request.
 * Always dials the supplier's phone_on_file, never the caller's number.
 */
export function followUpRequest(record: InboundCallRecord, supplier: SupplierProfile, why = BANK_CHANGE_REASON): CallRequest {
  const reason = [why];
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
  };
}
