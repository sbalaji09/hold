// Voice <-> app interface contract (see plan-voice.md "Interface contract").
// Plain TS types shared by Convex functions, the voice server and the web screens.
// Change these only together with the app person.

export type NumberSource = "on_file" | "background_check";

/** "live" dials a real phone. "simulated" runs Practice against a Claude-played supplier. */
export type CallMode = "live" | "simulated";

/**
 * Lifecycle of a call request. The app writes "queued"; voice moves it on.
 * queued -> dialing -> in_progress -> done
 *        \-> retry_scheduled -> queued (one retry) -> ... -> handed_off
 * Matches callRequests.status in convex/schema.ts (the app person's schema).
 */
export type CallRequestStatus =
  | "queued"
  | "dialing"
  | "in_progress"
  | "retry_scheduled"
  | "done"
  | "handed_off";

export interface CallRequest {
  call_id: string;
  bill_id: string;
  supplier_id: string;
  to_number: string; // E.164. Never a number taken from the email.
  number_source: NumberSource;
  reason: string[];
  status: CallRequestStatus;
  mode?: CallMode; // default "live"
  attempt: number; // dial attempts made so far
}

/** "onboarding" = Fogline's own facts about a new supplier (what it hired them for, what was agreed). */
export type SourceKind = "invoice" | "email" | "call" | "payment" | "onboarding";

export interface Source {
  kind: SourceKind;
  ref: string; // human label, e.g. "#4471"
  record_id?: string; // id of the underlying record, so the UI can open it
}

export type CallStatusValue =
  | "ringing"
  | "in_progress"
  | "no_answer"
  | "retry_scheduled"
  | "dropped"
  | "ended";

export type Speaker = "callback" | "supplier" | "caller";

export type CallEvent =
  | { call_id: string; type: "status"; value: CallStatusValue; retry_at?: string; retry_at_ms?: number }
  | { call_id: string; type: "segment"; speaker: Speaker; text: string; ts: number; end_ts?: number }
  | { call_id: string; type: "question"; ask: string; source: Source }
  | AskPersonEvent
  | PersonAnswerEvent;

/** A person on the team, as the app names them. */
export type Person = "maya" | "dev";

/**
 * hold couldn't judge an answer on its own and asked a person, mid-call. Shown on the Live call
 * screen until a PersonAnswerEvent with the same ask_id arrives.
 */
export interface AskPersonEvent {
  call_id: string;
  type: "ask_person";
  ask_id: string;
  ask: string; // the question hold asked on the call
  answer: string; // what the supplier said
  expected: string; // what the records say; shown to the team, never spoken
  source: Source;
  follow_up_allowed: boolean;
}

/**
 * The reply to an AskPersonEvent. First one wins. "no_reply" is written by voice when no one
 * answered in time; hold then judges the answer strictly on its own.
 */
export interface PersonAnswerEvent {
  call_id: string;
  type: "person_answer";
  ask_id: string;
  verdict: "matches" | "no_match" | "follow_up" | "no_reply";
  follow_up?: string;
  by?: Person;
}

/** Bank, account or credential words: hold never says these on a check call, whoever wrote the line. */
export function mentionsBankDetails(text: string): boolean {
  return /\b(?:bank|account|routing|iban|swift|sort code|password|pin|passcode)\b/i.test(text);
}

export type CallOutcome = "confirmed" | "not_confirmed" | "handed_off";

export interface Evidence {
  ask: string;
  source?: Source;
  answer: string;
  matches: boolean;
  /** Set when a person judged this answer during the call instead of hold. */
  decided_by?: Person;
}

export interface Clip {
  start_s: number;
  end_s: number;
}

export interface CallResult {
  call_id: string;
  outcome: CallOutcome;
  evidence: Evidence[];
  summary: string;
  recording_url?: string;
  clip?: Clip;
}

export interface StyleMatchResult {
  matches: boolean;
  score: number; // 0..1
  compared_with: number; // how many past emails it was compared against
  reasons: string[]; // plain-words evidence for the bill page
}

/** A supplier record as voice sees it, normalised from the app's tables. Indexed in Moss. */
export interface SupplierRecord {
  id: string; // stable id, e.g. Convex _id
  supplier_id: string;
  kind: SourceKind;
  ref: string; // "#4471", "Email 12 Sep", "Call 3 Aug"
  date: string; // ISO date
  text: string; // full searchable text
  amount_cents?: number;
}

export interface SupplierProfile {
  supplier_id: string;
  name: string;
  phone_on_file: string; // E.164
  aliases: string[]; // names a caller might use ("Stagecraft", "the stage people")
  language?: string; // BCP-47 code to speak on check calls ("es"). Absent = "en".
  phone_menu?: string; // keys to press after pickup to reach them (Twilio sendDigits, "ww2")
  time_zone?: string; // IANA zone for calling hours. Absent = the company's.
}

export interface InboundCallRecord {
  call_id: string; // "in_<twilio sid>"
  caller_number: string;
  claimed_identity: string; // "Dev from Fogline", "Rosa at Stagecraft Rigging"; "Unknown caller" if never said
  claimed_supplier_id?: string;
  requested: string; // what they asked for, plain words
  asked_bank_change: boolean;
  transcript: { speaker: Speaker; text: string; ts: number }[];
  triggered_call_id?: string; // callRequests row created to the number on file
}

export const DISCLOSURE =
  "Hi, this is an automated assistant calling for Fogline's accounts team. This call is recorded.";

export const INBOUND_GREETING =
  "Hi, you've reached Fogline's accounts team. I'm an automated assistant, and this call is recorded. How can I help?";

export const CALLBACK_PROMISE = "We'll call you back on the number we have.";

/** Max dial attempts before handing off to Maya (first try + one retry). */
export const MAX_ATTEMPTS = 2;
