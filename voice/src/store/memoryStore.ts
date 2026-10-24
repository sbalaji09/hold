// In-memory VoiceStore with the same semantics as the Convex functions (convex/voice/*).
// For tests and local runs without Convex. Lifecycle rules come from convex/voice/rules.ts.
import {
  MAX_ATTEMPTS,
  type CallEvent,
  type CallRequest,
  type CallResult,
  type InboundCallRecord,
  type PersonAnswerEvent,
  type SupplierProfile,
  type SupplierRecord,
} from "../../../shared/contract.js";
import {
  DEFAULT_RETRY_DELAY_MS,
  followUpRequest,
  formatRetryAt,
  isClosed,
  noAnswerHandoff,
  TAKEOVER_BEFORE_CONNECT_SUMMARY,
  UNKNOWN_CALLER,
} from "../../../convex/voice/rules.js";
import type { PhoneTactic, VoiceStore } from "./types.js";

export interface MemoryInboundCall extends InboundCallRecord {
  status: "in_progress" | "ended";
  recording_url?: string;
}

export interface MemoryStoreOptions {
  retryDelayMs?: number;
  now?: () => number;
  suppliers?: SupplierProfile[];
  records?: SupplierRecord[];
  phonePlaybook?: PhoneTactic[];
}

interface RequestRow extends CallRequest {
  retry_at_ms?: number;
  twilio_call_sid?: string;
  takeover_requested?: boolean;
  started_at_ms?: number;
  recording_url?: string;
}

export class MemoryStore implements VoiceStore {
  readonly requests = new Map<string, RequestRow>();
  readonly events: CallEvent[] = [];
  readonly results = new Map<string, CallResult>();
  readonly inbound = new Map<string, MemoryInboundCall>();
  readonly suppliers = new Map<string, SupplierProfile>();
  readonly records: SupplierRecord[] = [];
  private readonly phonePlaybook: PhoneTactic[];

  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly queuedWatchers = new Set<(r: CallRequest[]) => void>();
  private readonly takeoverWatchers = new Map<string, Set<() => void>>();
  private readonly answerWatchers = new Set<{ call_id: string; ask_id: string; cb: (a: PersonAnswerEvent) => void }>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private recordingSeq = 0;

  constructor(opts: MemoryStoreOptions = {}) {
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.now = opts.now ?? (() => Date.now());
    for (const s of opts.suppliers ?? []) this.suppliers.set(s.supplier_id, s);
    this.records.push(...(opts.records ?? []));
    this.phonePlaybook = opts.phonePlaybook ?? [];
  }

  // ---- Test / app-side helpers (not part of VoiceStore) ----

  /** What the app does: insert a call_request (normally status "queued"). */
  addRequest(req: Omit<CallRequest, "status" | "attempt"> & Partial<Pick<CallRequest, "status" | "attempt">>): void {
    if (this.requests.has(req.call_id)) throw new Error(`call request ${req.call_id} already exists`);
    this.requests.set(req.call_id, { status: "queued", attempt: 0, ...req });
    this.notifyQueued();
  }

  /** What the Live call screen does (convex/voice/ui.ts requestTakeover). */
  async requestTakeover(call_id: string): Promise<void> {
    const row = this.mustGet(call_id);
    if (!row.takeover_requested) {
      row.takeover_requested = true;
      for (const cb of this.takeoverWatchers.get(call_id) ?? []) cb();
    }
    if (row.status === "queued" || row.status === "retry_scheduled") {
      await this.finishCall({ call_id, outcome: "handed_off", evidence: [], summary: TAKEOVER_BEFORE_CONNECT_SUMMARY });
    }
  }

  /** What the Live call screen does (convex/voice/ui.ts answerAsk). False if the question is already closed. */
  answerAsk(answer: Omit<PersonAnswerEvent, "type">): boolean {
    if (this.personAnswer(answer.call_id, answer.ask_id)) return false;
    const event: PersonAnswerEvent = { ...answer, type: "person_answer" };
    this.events.push(event);
    for (const w of this.answerWatchers) if (w.call_id === answer.call_id && w.ask_id === answer.ask_id) w.cb(event);
    return true;
  }

  private personAnswer(call_id: string, ask_id: string): PersonAnswerEvent | undefined {
    return this.events.find((e): e is PersonAnswerEvent => e.type === "person_answer" && e.call_id === call_id && e.ask_id === ask_id);
  }

  eventsFor(call_id: string): CallEvent[] {
    return this.events.filter((e) => e.call_id === call_id);
  }

  /** Cancels pending retry timers. */
  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ---- VoiceStore ----

  watchQueuedRequests(cb: (requests: CallRequest[]) => void): () => void {
    this.queuedWatchers.add(cb);
    cb(this.queued());
    return () => this.queuedWatchers.delete(cb);
  }

  async claimRequest(call_id: string): Promise<CallRequest | null> {
    const row = this.requests.get(call_id);
    if (!row || row.status !== "queued") return null;
    row.status = "dialing";
    row.attempt += 1;
    this.notifyQueued();
    return toRequest(row);
  }

  async getRequest(call_id: string): Promise<CallRequest | null> {
    const row = this.requests.get(call_id);
    return row ? toRequest(row) : null;
  }

  watchTakeover(call_id: string, cb: () => void): () => void {
    let set = this.takeoverWatchers.get(call_id);
    if (!set) this.takeoverWatchers.set(call_id, (set = new Set()));
    set.add(cb);
    if (this.requests.get(call_id)?.takeover_requested) cb();
    return () => set.delete(cb);
  }

  watchPersonAnswer(call_id: string, ask_id: string, cb: (answer: PersonAnswerEvent) => void): () => void {
    const existing = this.personAnswer(call_id, ask_id);
    if (existing) {
      cb(existing);
      return () => {};
    }
    const w = { call_id, ask_id, cb };
    this.answerWatchers.add(w);
    return () => this.answerWatchers.delete(w);
  }

  async closeAsk(call_id: string, ask_id: string): Promise<PersonAnswerEvent | null> {
    const existing = this.personAnswer(call_id, ask_id);
    if (existing) return existing;
    this.events.push({ call_id, type: "person_answer", ask_id, verdict: "no_reply" });
    return null;
  }

  async setTwilioCallSid(call_id: string, sid: string): Promise<void> {
    this.mustGet(call_id).twilio_call_sid = sid;
  }

  async markInProgress(call_id: string): Promise<void> {
    const row = this.mustGet(call_id);
    if (isClosed(row.status)) return;
    row.status = "in_progress";
    row.started_at_ms ??= this.now();
  }

  async appendEvent(event: CallEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async reportNoAnswer(call_id: string): Promise<{ retry_at_ms: number | null }> {
    const row = this.mustGet(call_id);
    if (isClosed(row.status)) return { retry_at_ms: null };
    if (row.status === "retry_scheduled") return { retry_at_ms: row.retry_at_ms ?? null };
    // A retry needs a fresh claim; a request still "queued" was never dialed.
    if (row.status === "queued") throw new Error(`Call request ${call_id} was never claimed`);

    this.events.push({ call_id, type: "status", value: "no_answer" });
    if (row.attempt < MAX_ATTEMPTS) {
      const retry_at_ms = this.now() + this.retryDelayMs;
      row.status = "retry_scheduled";
      row.retry_at_ms = retry_at_ms;
      this.events.push({
        call_id,
        type: "status",
        value: "retry_scheduled",
        retry_at: formatRetryAt(retry_at_ms),
        retry_at_ms,
      });
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.requeue(call_id);
      }, this.retryDelayMs);
      this.timers.add(t);
      return { retry_at_ms };
    }
    await this.finishCall(noAnswerHandoff(call_id));
    return { retry_at_ms: null };
  }

  async finishCall(result: CallResult): Promise<void> {
    const row = this.mustGet(result.call_id);
    if (this.results.has(result.call_id)) return; // never overwrite a result
    const stored = structuredClone(result);
    // A recording that arrived first wins over a URL passed in by the caller.
    if (row.recording_url) stored.recording_url = row.recording_url;
    this.results.set(result.call_id, stored);
    row.status = result.outcome === "handed_off" ? "handed_off" : "done";
    row.retry_at_ms = undefined;
    this.events.push({ call_id: result.call_id, type: "status", value: "ended" });
    this.notifyQueued();
  }

  async attachRecording(call_id: string, audio: Uint8Array, contentType: string): Promise<void> {
    if (audio.byteLength === 0) throw new Error("empty recording");
    void contentType;
    const url = `memory://recordings/${call_id}/${++this.recordingSeq}`;
    const inbound = this.inbound.get(call_id);
    if (inbound && !this.requests.has(call_id)) {
      inbound.recording_url = url;
      return;
    }
    const row = this.mustGet(call_id);
    row.recording_url = url;
    const result = this.results.get(call_id);
    if (result) result.recording_url = url;
  }

  async getSupplierProfile(supplier_id: string): Promise<SupplierProfile | null> {
    const s = this.suppliers.get(supplier_id);
    return s ? structuredClone(s) : null;
  }

  async listSupplierProfiles(): Promise<SupplierProfile[]> {
    return [...this.suppliers.values()].map((s) => structuredClone(s));
  }

  async getPhonePlaybook(): Promise<PhoneTactic[]> {
    return structuredClone(this.phonePlaybook);
  }

  async getSupplierRecords(supplier_id: string): Promise<SupplierRecord[]> {
    return this.records.filter((r) => r.supplier_id === supplier_id).map((r) => structuredClone(r));
  }

  async startInboundCall(call_id: string, caller_number: string): Promise<void> {
    if (this.inbound.has(call_id)) return;
    this.inbound.set(call_id, {
      call_id,
      caller_number,
      claimed_identity: UNKNOWN_CALLER,
      requested: "",
      status: "in_progress",
      asked_bank_change: false,
      transcript: [],
    });
  }

  async finishInboundCall(record: InboundCallRecord): Promise<{ triggered_call_id: string | null }> {
    const existing = this.inbound.get(record.call_id);
    if (existing?.status === "ended") return { triggered_call_id: existing.triggered_call_id ?? null };

    let triggered_call_id: string | undefined;
    const supplier = record.claimed_supplier_id ? this.suppliers.get(record.claimed_supplier_id) : undefined;
    if (record.asked_bank_change && supplier) {
      const req = followUpRequest(record, supplier);
      if (!this.requests.has(req.call_id)) this.addRequest(req);
      triggered_call_id = req.call_id;
    }
    this.inbound.set(record.call_id, {
      ...structuredClone(record),
      caller_number: existing?.caller_number ?? record.caller_number,
      recording_url: existing?.recording_url,
      claimed_identity: record.claimed_identity || UNKNOWN_CALLER,
      status: "ended",
      triggered_call_id,
    });
    return { triggered_call_id: triggered_call_id ?? null };
  }

  // ---- internals ----

  private requeue(call_id: string): void {
    const row = this.requests.get(call_id);
    if (!row || row.status !== "retry_scheduled") return;
    row.status = "queued";
    row.retry_at_ms = undefined;
    this.notifyQueued();
  }

  private queued(): CallRequest[] {
    return [...this.requests.values()].filter((r) => r.status === "queued").map(toRequest);
  }

  private notifyQueued(): void {
    const list = this.queued();
    for (const cb of this.queuedWatchers) cb(list);
  }

  private mustGet(call_id: string): RequestRow {
    const row = this.requests.get(call_id);
    if (!row) throw new Error(`Unknown call request ${call_id}`);
    return row;
  }
}

function toRequest(row: RequestRow): CallRequest {
  const { call_id, bill_id, supplier_id, to_number, number_source, reason, status, mode, attempt } = row;
  const out: CallRequest = { call_id, bill_id, supplier_id, to_number, number_source, reason: [...reason], status, attempt };
  if (mode) out.mode = mode;
  return out;
}
