// VoiceStore over Convex (convex/voice/server.ts). Subscriptions use the websocket client;
// every call passes VOICE_SERVER_SECRET, which Convex checks against its own env var.
import { ConvexClient } from "convex/browser";
import type { CallEvent, CallRequest, CallResult, InboundCallRecord, PersonAnswerEvent, SupplierRecord } from "../../../shared/contract.js";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import type { VoiceStore } from "./types.js";

const fns = api.voice.server;

export class ConvexStore implements VoiceStore {
  constructor(
    private readonly client: ConvexClient,
    private readonly secret: string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ConvexStore {
    const url = env.CONVEX_URL?.replace(/\/+$/, ""); // "//api/query" fails with an empty error
    const secret = env.VOICE_SERVER_SECRET;
    if (!url || !secret) throw new Error("CONVEX_URL and VOICE_SERVER_SECRET must be set");
    return new ConvexStore(new ConvexClient(url), secret);
  }

  close(): Promise<void> {
    return this.client.close();
  }

  watchQueuedRequests(cb: (requests: CallRequest[]) => void): () => void {
    return this.client.onUpdate(fns.queuedRequests, { secret: this.secret }, cb, (err) =>
      console.error("[convexStore] queuedRequests subscription failed", err),
    );
  }

  claimRequest(call_id: string): Promise<CallRequest | null> {
    return this.client.mutation(fns.claimRequest, { secret: this.secret, call_id });
  }

  getRequest(call_id: string): Promise<CallRequest | null> {
    return this.client.query(fns.getRequest, { secret: this.secret, call_id });
  }

  watchTakeover(call_id: string, cb: () => void): () => void {
    let fired = false;
    return this.client.onUpdate(
      fns.takeoverRequested,
      { secret: this.secret, call_id },
      (requested) => {
        if (requested && !fired) {
          fired = true;
          cb();
        }
      },
      (err) => console.error(`[convexStore] takeover subscription failed for ${call_id}`, err),
    );
  }

  watchPersonAnswer(call_id: string, ask_id: string, cb: (answer: PersonAnswerEvent) => void): () => void {
    let fired = false;
    return this.client.onUpdate(
      fns.personAnswer,
      { secret: this.secret, call_id, ask_id },
      (row) => {
        if (row && !fired) {
          fired = true;
          cb(row);
        }
      },
      (err) => console.error(`[convexStore] personAnswer subscription failed for ${call_id}`, err),
    );
  }

  watchSupplierHistory(cb: (supplier_id: string, records: SupplierRecord[]) => void): () => void {
    // ponytail: one subscription per supplier, each re-run on any email change; fine at ~25 payees.
    const subs = new Map<string, () => void>();
    const stopList = this.client.onUpdate(
      fns.listSupplierProfiles,
      { secret: this.secret },
      (profiles) => {
        for (const { supplier_id } of profiles) {
          if (subs.has(supplier_id)) continue;
          subs.set(
            supplier_id,
            this.client.onUpdate(fns.getSupplierRecords, { secret: this.secret, supplier_id }, (records) => cb(supplier_id, records), (err) =>
              console.error(`[convexStore] history subscription failed for ${supplier_id}`, err),
            ),
          );
        }
      },
      (err) => console.error("[convexStore] supplier list subscription failed", err),
    );
    return () => {
      stopList();
      for (const stop of subs.values()) stop();
    };
  }

  async closeAsk(call_id: string, ask_id: string): Promise<PersonAnswerEvent | null> {
    return this.client.mutation(fns.closeAsk, { secret: this.secret, call_id, ask_id });
  }

  async setTwilioCallSid(call_id: string, sid: string): Promise<void> {
    await this.client.mutation(fns.setTwilioCallSid, { secret: this.secret, call_id, sid });
  }

  async markInProgress(call_id: string): Promise<void> {
    await this.client.mutation(fns.markInProgress, { secret: this.secret, call_id });
  }

  async appendEvent(event: CallEvent): Promise<void> {
    await this.client.mutation(fns.appendEvent, { secret: this.secret, event });
  }

  reportNoAnswer(call_id: string): Promise<{ retry_at_ms: number | null }> {
    return this.client.mutation(fns.reportNoAnswer, { secret: this.secret, call_id });
  }

  async finishCall(result: CallResult): Promise<void> {
    await this.client.mutation(fns.finishCall, { secret: this.secret, result });
  }

  async attachRecording(call_id: string, audio: Uint8Array, contentType: string): Promise<void> {
    const uploadUrl = await this.client.mutation(fns.generateUploadUrl, { secret: this.secret });
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(audio), // copy: fetch wants an ArrayBuffer-backed view
    });
    if (!res.ok) throw new Error(`Recording upload failed: ${res.status} ${await res.text()}`);
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    await this.client.mutation(fns.attachRecording, { secret: this.secret, call_id, storage_id: storageId });
  }

  getSupplierProfile(supplier_id: string) {
    return this.client.query(fns.getSupplierProfile, { secret: this.secret, supplier_id });
  }

  listSupplierProfiles() {
    return this.client.query(fns.listSupplierProfiles, { secret: this.secret });
  }

  getSupplierRecords(supplier_id: string) {
    return this.client.query(fns.getSupplierRecords, { secret: this.secret, supplier_id });
  }

  getPhonePlaybook() {
    return this.client.query(fns.phonePlaybook, { secret: this.secret });
  }

  getCompany() {
    return this.client.query(api.app.company.current, {});
  }

  async startInboundCall(call_id: string, caller_number: string): Promise<void> {
    await this.client.mutation(fns.startInboundCall, { secret: this.secret, call_id, caller_number });
  }

  finishInboundCall(record: InboundCallRecord): Promise<{ triggered_call_id: string | null }> {
    return this.client.mutation(fns.finishInboundCall, { secret: this.secret, record });
  }
}
