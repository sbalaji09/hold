// Everything the voice server reads from or writes to Convex goes through this interface.
// ConvexStore (convexStore.ts) is the real one; tests use an in-memory fake.
import type {
  CallEvent,
  CallRequest,
  CallResult,
  InboundCallRecord,
  PersonAnswerEvent,
  SupplierProfile,
  SupplierRecord,
} from "../../../shared/contract.js";
import type { Company } from "../../../lib/company.js";

export interface PhoneTactic {
  name: string;
  signals: string[];
}

export interface VoiceStore {
  /** Calls back with every request currently in status "queued" (live subscription). */
  watchQueuedRequests(cb: (requests: CallRequest[]) => void): () => void;
  /** Atomically queued -> dialing and attempt += 1. Returns null if someone else claimed it. */
  claimRequest(call_id: string): Promise<CallRequest | null>;
  getRequest(call_id: string): Promise<CallRequest | null>;
  /** Fires when the approver presses "End call and take over". */
  watchTakeover(call_id: string, cb: () => void): () => void;
  /** Fires once with the first person's reply to a mid-call question (ask_person event). */
  watchPersonAnswer(call_id: string, ask_id: string, cb: (answer: PersonAnswerEvent) => void): () => void;
  /** Fires with every supplier's history, then again for each supplier whose history changes. */
  watchSupplierHistory(cb: (supplier_id: string, records: SupplierRecord[]) => void): () => void;
  /** Stops waiting for a reply. Returns the reply if one already came, else records "deferred" (reviewed after the call). */
  closeAsk(call_id: string, ask_id: string): Promise<PersonAnswerEvent | null>;
  /** The approver set themselves away: hold doesn't ask them mid-call, answers wait for review. */
  isCheckerAway(): Promise<boolean>;
  setTwilioCallSid(call_id: string, sid: string): Promise<void>;
  markInProgress(call_id: string): Promise<void>;
  /** Keep-alive the voice server sends every ~15s it is running, so the UI can tell when it has died. */
  heartbeat(): Promise<void>;

  appendEvent(event: CallEvent): Promise<void>;
  /**
   * No answer on this attempt. Convex either schedules the one retry
   * (writes no_answer + retry_scheduled events) or, after MAX_ATTEMPTS, writes a handed_off result.
   */
  reportNoAnswer(call_id: string): Promise<{ retry_at_ms: number | null }>;
  /** Writes the result, closes the request (done / handed_off) and emits status "ended". */
  finishCall(result: CallResult): Promise<void>;
  /** Uploads recording audio (wav/mp3 bytes) and sets recording_url on the result or inbound call. */
  attachRecording(call_id: string, audio: Uint8Array, contentType: string): Promise<void>;

  getSupplierProfile(supplier_id: string): Promise<SupplierProfile | null>;
  listSupplierProfiles(): Promise<SupplierProfile[]>;
  getSupplierRecords(supplier_id: string): Promise<SupplierRecord[]>;
  /** Who hold works for (lib/company.ts): the name, team and words every call uses. */
  getCompany(): Promise<Company>;
  /** The playbook's phone tactics (names and signals), for the incoming line's prompt. */
  getPhonePlaybook(): Promise<PhoneTactic[]>;

  startInboundCall(call_id: string, caller_number: string): Promise<void>;
  /**
   * Closes the inbound record. If asked_bank_change and claimed_supplier_id resolve to a supplier,
   * Convex creates a call_request to that supplier's phone_on_file (never the caller's number)
   * and returns its call_id.
   */
  finishInboundCall(record: InboundCallRecord): Promise<{ triggered_call_id: string | null }>;
}
