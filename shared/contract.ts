// Voice <-> app interface contract (see plan-voice.md "Interface contract").
// Plain TS types shared by Convex functions, the voice server and the web screens.
// Change these only together with the app person.

/** "approver": the approver's own phone (TAKEOVER_PHONE_NUMBER on the voice server), for an approval call. */
export type NumberSource = "on_file" | "background_check" | "approver";

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
  /** A call back to ask one question the approver wrote while reviewing an answer. */
  follow_up?: FollowUp;
  /**
   * A call back after someone on the company's line asked it to send money: what they asked, as a
   * phrase finishing "asking us to ..." ("send the difference because the deposit was reduced by a
   * processing fee"). The call asks the supplier whether they made that request.
   */
  claim?: string;
  /**
   * Not a check call: someone from a company hold has no record of called the line and asked for
   * money. This call rings the approver, tells them what was asked and asks approve or deny.
   */
  approval?: ApprovalAsk;
}

/** What an approval call tells the approver. All of it is what the caller said, not anything on file. */
export interface ApprovalAsk {
  inbound_call_id: string;
  caller: string; // "Jordan from Microsoft"; "Unknown caller" if never said
  company?: string;
  request: string; // what they asked for, e.g. "send fifty dollars in Amazon gift cards"
  caller_number: string;
}

/**
 * The approver reviewed an answer after the call and wants one more question asked. The call
 * asks only `ask`; its answer goes back to the approver. `carried` is what the first call already
 * checked, so the call back's result covers the whole check.
 */
export interface FollowUp {
  ask: string;
  source: Source;
  carried: Evidence[];
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
  | "ended"
  | "outside_hours"; // waiting for the payee's calling hours; retry_at says when

export type Speaker = "callback" | "supplier" | "caller";

export type CallEvent =
  | { call_id: string; type: "status"; value: CallStatusValue; retry_at?: string; retry_at_ms?: number }
  | { call_id: string; type: "segment"; speaker: Speaker; text: string; ts: number; end_ts?: number }
  | { call_id: string; type: "question"; ask: string; source: Source }
  | AskPersonEvent
  | PersonAnswerEvent;

/** The approver, the app's one human role, stored internally as the literal "dev". */
export type Person = "dev";

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
  /** The record in the supplier's history the answer sounds most like (Moss, live), if another one. */
  closest?: string;
}

/**
 * The reply to an AskPersonEvent. During the call the first one wins. "deferred" is written by voice
 * when no one answered in time (or the approver is away): the answer waits for the approver's review
 * after the call, and a later "matches", "no_match" or "follow_up" decides it. "no_reply" is the
 * older form of the same, before reviews existed.
 */
export interface PersonAnswerEvent {
  call_id: string;
  type: "person_answer";
  ask_id: string;
  verdict: "matches" | "no_match" | "follow_up" | "deferred" | "no_reply";
  follow_up?: string;
  by?: Person;
}

/**
 * Mid-call questions that wait for the approver's review: voice deferred them (nobody answered in
 * time, or the approver was away) and no one has decided them since.
 */
export function waitingForReview<E extends { type: string }>(events: E[]): Extract<E, { type: "ask_person" }>[] {
  // Structural, so stored rows (Convex docs) work as well as contract events.
  type Ev = { type: string; ask_id?: string; verdict?: string };
  const replies = new Map<string, string[]>();
  for (const e of events as Ev[]) if (e.type === "person_answer") replies.set(e.ask_id!, [...(replies.get(e.ask_id!) ?? []), e.verdict!]);
  return events.filter((e) => e.type === "ask_person" && replies.get((e as Ev).ask_id!)?.join() === "deferred") as Extract<E, { type: "ask_person" }>[];
}

/** Bank, account or credential words: hold never says these on a check call, whoever wrote the line. */
export function mentionsBankDetails(text: string): boolean {
  return /\b(?:bank|account|routing|iban|swift|sort code|password|pin|passcode|banco|bancaria|cuenta|contraseña|clave)\b/i.test(text);
}

/** "needs_review": everything else checked out, and an answer waits for the approver's review. */
export type CallOutcome = "confirmed" | "not_confirmed" | "handed_off" | "needs_review";

export interface Evidence {
  ask: string;
  source?: Source;
  answer: string;
  matches: boolean;
  /** Set when a person judged this answer (during the call, or reviewing it after) instead of hold. */
  decided_by?: Person;
  /** The ask_person event this answer went to, if hold asked a person about it. */
  ask_id?: string;
  /** Nobody judged it yet: waits for the approver's review. `matches` is false until then. */
  pending_review?: boolean;
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
  /** They asked the company to send money; see CallRequest.claim. */
  payment_claim?: string;
  /** The company they said they call from, matched or not. */
  claimed_company?: string;
  transcript: { speaker: Speaker; text: string; ts: number }[];
  triggered_call_id?: string; // callRequests row created to the number on file
}

export const DISCLOSURE =
  "Hi, this is an automated assistant calling for Fogline's accounts team. This call is recorded.";

export const INBOUND_GREETING =
  "Hi, you've reached Fogline's accounts team. I'm an automated assistant, and this call is recorded. How can I help?";

export const CALLBACK_PROMISE = "We'll call you back on the number we have.";

/** Max dial attempts before handing off to the approver (first try + one retry). */
export const MAX_ATTEMPTS = 2;
