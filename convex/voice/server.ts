// Voice-server API. Every function takes `secret` and checks it against VOICE_SERVER_SECRET.
// These mirror voice/src/store/types.ts (VoiceStore) one to one; the client is voice/src/store/convexStore.ts.
// Rows live in the app's tables (callRequests, callEvents, callResults, inboundCalls); this file
// maps them to and from the contract types in shared/contract.ts.
import { v } from "convex/values";
import {
  MAX_ATTEMPTS,
  type CallRequest,
  type CallResult,
  type SourceKind,
} from "../../shared/contract.js";
import { internal } from "../_generated/api.js";
import type { Doc } from "../_generated/dataModel.js";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server.js";
import schema from "../schema.js";
import * as records from "./records.js";
import { followUpRequest, formatRetryAt, isClosed, noAnswerHandoff, retryDelayMs, UNKNOWN_CALLER } from "./rules.js";

// ---------- auth ----------

/** Constant-time string compare (no node:crypto in the default Convex runtime). */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function assertVoiceSecret(secret: string): void {
  const expected = process.env.VOICE_SERVER_SECRET;
  if (!expected) throw new Error("VOICE_SERVER_SECRET is not set on this Convex deployment");
  if (!safeEqual(secret, expected)) throw new Error("Unauthorized");
}

const secret = v.string();

// ---------- row <-> contract mapping ----------

type RequestRow = Doc<"callRequests">;

export function toCallRequest(d: RequestRow): CallRequest {
  const r: CallRequest = {
    call_id: d.call_id,
    bill_id: d.bill_id,
    supplier_id: d.supplier_id,
    to_number: d.to_number,
    number_source: d.number_source,
    reason: d.reason,
    status: d.status,
    attempt: d.attempt ?? 0,
  };
  if (d.mode) r.mode = d.mode;
  return r;
}

export function toCallResult(d: Doc<"callResults">): CallResult {
  const r: CallResult = {
    call_id: d.call_id,
    outcome: d.outcome,
    evidence: d.evidence.map((e) => ({
      ask: e.ask,
      answer: e.answer,
      matches: e.matches,
      ...(e.source ? { source: { ...e.source, kind: e.source.kind as SourceKind } } : {}),
    })),
    summary: d.summary,
  };
  if (d.recording_url) r.recording_url = d.recording_url;
  if (d.clip) r.clip = d.clip;
  return r;
}

// ---------- lookups ----------

export async function findRequest(ctx: QueryCtx, call_id: string): Promise<RequestRow | null> {
  return ctx.db
    .query("callRequests")
    .withIndex("by_key", (q) => q.eq("call_id", call_id))
    .unique();
}

async function mustFindRequest(ctx: QueryCtx, call_id: string): Promise<RequestRow> {
  const row = await findRequest(ctx, call_id);
  if (!row) throw new Error(`Unknown call request ${call_id}`);
  return row;
}

export async function findResult(ctx: QueryCtx, call_id: string): Promise<Doc<"callResults"> | null> {
  return ctx.db
    .query("callResults")
    .withIndex("by_call", (q) => q.eq("call_id", call_id))
    .unique();
}

async function findInbound(ctx: QueryCtx, call_id: string): Promise<Doc<"inboundCalls"> | null> {
  return ctx.db
    .query("inboundCalls")
    .withIndex("by_key", (q) => q.eq("call_id", call_id))
    .unique();
}

/**
 * Writes the result once (never overwrites), closes the request and emits status "ended".
 * Shared by finishCall, the no-answer hand-off and takeover before connect.
 */
export async function writeResult(ctx: MutationCtx, result: CallResult): Promise<void> {
  const req = await mustFindRequest(ctx, result.call_id);
  if (await findResult(ctx, result.call_id)) return;
  // A recording that arrived first wins over a URL passed in by the caller.
  const storedUrl = req.recording_storage_id ? await ctx.storage.getUrl(req.recording_storage_id) : null;
  await ctx.db.insert("callResults", {
    call_id: result.call_id,
    outcome: result.outcome,
    evidence: result.evidence,
    summary: result.summary,
    clip: result.clip,
    recording_storage_id: req.recording_storage_id,
    recording_url: storedUrl ?? result.recording_url ?? "",
    startedAt: req.startedAt,
  });
  await ctx.db.patch(req._id, {
    status: result.outcome === "handed_off" ? "handed_off" : "done",
    retry_at_ms: undefined,
  });
  await ctx.db.insert("callEvents", { call_id: result.call_id, type: "status", value: "ended" });
  // The app moves the bill (Held / Needs you / Scheduled). Scheduled, not called inline, so an app
  // error can never roll back the call result.
  await ctx.scheduler.runAfter(0, internal.app.callOutcome.applyCallResult, { call_id: result.call_id });
  // Addendum: a New supplier becomes Trusted after its first confirmed live call.
  if (result.outcome === "confirmed" && req.mode !== "simulated") {
    const sup = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", req.supplier_id))
      .unique();
    if (sup?.status === "new") await ctx.db.patch(sup._id, { status: "trusted" });
  }
}

// ---------- validators (from the schema, so they cannot drift) ----------

const callEvent = schema.tables.callEvents.validator;
const resultFields = schema.tables.callResults.validator.fields;
const callResult = v.object({
  call_id: v.string(),
  outcome: resultFields.outcome,
  evidence: resultFields.evidence,
  summary: v.string(),
  recording_url: v.optional(v.string()),
  clip: resultFields.clip,
});

// The contract's Speaker; inbound transcripts store "supplier" lines as "caller".
const anySpeaker = v.union(v.literal("callback"), v.literal("supplier"), v.literal("caller"));
const inboundRecord = v.object({
  call_id: v.string(),
  caller_number: v.string(),
  claimed_identity: v.string(),
  claimed_supplier_id: v.optional(v.string()),
  requested: v.string(),
  asked_bank_change: v.boolean(),
  transcript: v.array(v.object({ speaker: anySpeaker, text: v.string(), ts: v.number() })),
  triggered_call_id: v.optional(v.string()),
});

// ---------- outbound ----------

/** Every request in status "queued". The dialer subscribes to this. */
export const queuedRequests = query({
  args: { secret },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    const rows = await ctx.db
      .query("callRequests")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    return rows.map(toCallRequest);
  },
});

/** Atomically queued -> dialing, attempt += 1. Null if it is not queued (someone else claimed it). */
export const claimRequest = mutation({
  args: { secret, call_id: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    const row = await findRequest(ctx, args.call_id);
    if (!row || row.status !== "queued") return null;
    const attempt = (row.attempt ?? 0) + 1;
    await ctx.db.patch(row._id, { status: "dialing", attempt, retry_at_ms: undefined });
    return toCallRequest({ ...row, status: "dialing", attempt });
  },
});

export const getRequest = query({
  args: { secret, call_id: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    const row = await findRequest(ctx, args.call_id);
    return row ? toCallRequest(row) : null;
  },
});

/** True once Maya pressed "End call and take over". The voice server subscribes to this. */
export const takeoverRequested = query({
  args: { secret, call_id: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    return (await findRequest(ctx, args.call_id))?.takeover_requested === true;
  },
});

export const setTwilioCallSid = mutation({
  args: { secret, call_id: v.string(), sid: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    const row = await mustFindRequest(ctx, args.call_id);
    await ctx.db.patch(row._id, { twilio_call_sid: args.sid });
  },
});

export const markInProgress = mutation({
  args: { secret, call_id: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    const row = await mustFindRequest(ctx, args.call_id);
    if (isClosed(row.status)) return;
    await ctx.db.patch(row._id, { status: "in_progress", startedAt: row.startedAt ?? new Date().toISOString() });
  },
});

/** Live events for outbound and inbound calls (inbound transcript segments use the inbound call_id). */
export const appendEvent = mutation({
  args: { secret, event: callEvent },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    await ctx.db.insert("callEvents", args.event);
  },
});

/**
 * No answer on this attempt. Schedules the one retry, or after MAX_ATTEMPTS writes a handed_off result.
 * Repeated reports for the same attempt are no-ops.
 */
export const reportNoAnswer = mutation({
  args: { secret, call_id: v.string() },
  handler: async (ctx, args): Promise<{ retry_at_ms: number | null }> => {
    assertVoiceSecret(args.secret);
    const row = await mustFindRequest(ctx, args.call_id);
    if (isClosed(row.status)) return { retry_at_ms: null };
    if (row.status === "retry_scheduled") return { retry_at_ms: row.retry_at_ms ?? null };
    if (row.status === "queued") throw new Error(`Call request ${args.call_id} was never claimed`);

    await ctx.db.insert("callEvents", { call_id: row.call_id, type: "status", value: "no_answer" });
    if ((row.attempt ?? 0) < MAX_ATTEMPTS) {
      const retry_at_ms = Date.now() + retryDelayMs(process.env.CALL_RETRY_DELAY_MS);
      await ctx.db.patch(row._id, { status: "retry_scheduled", retry_at_ms });
      await ctx.db.insert("callEvents", {
        call_id: row.call_id,
        type: "status",
        value: "retry_scheduled",
        retry_at: formatRetryAt(retry_at_ms),
        retry_at_ms,
      });
      await ctx.scheduler.runAt(retry_at_ms, internal.voice.server.requeue, { call_id: row.call_id });
      return { retry_at_ms };
    }
    await writeResult(ctx, noAnswerHandoff(row.call_id));
    return { retry_at_ms: null };
  },
});

/** Scheduled by reportNoAnswer: retry_scheduled -> queued so the dialer picks it up again. */
export const requeue = internalMutation({
  args: { call_id: v.string() },
  handler: async (ctx, args) => {
    const row = await findRequest(ctx, args.call_id);
    if (!row || row.status !== "retry_scheduled") return; // taken over or closed meanwhile
    await ctx.db.patch(row._id, { status: "queued", retry_at_ms: undefined });
  },
});

/** Idempotent: the first result for a call wins and is never overwritten. */
export const finishCall = mutation({
  args: { secret, result: callResult },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    await writeResult(ctx, args.result as CallResult);
  },
});

export const generateUploadUrl = mutation({
  args: { secret },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Links an uploaded recording to the call. Works whether the result row exists yet or not:
 * the request row keeps the storage id, and writeResult copies it onto a later result.
 */
export const attachRecording = mutation({
  args: { secret, call_id: v.string(), storage_id: v.id("_storage") },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    const req = await mustFindRequest(ctx, args.call_id);
    const recording_url = await ctx.storage.getUrl(args.storage_id);
    if (!recording_url) throw new Error("Uploaded recording not found in storage");
    const old = req.recording_storage_id;
    await ctx.db.patch(req._id, { recording_storage_id: args.storage_id });
    const result = await findResult(ctx, args.call_id);
    if (result) await ctx.db.patch(result._id, { recording_storage_id: args.storage_id, recording_url });
    if (old && old !== args.storage_id) await ctx.storage.delete(old);
  },
});

// ---------- supplier data (read through records.ts) ----------

export const getSupplierProfile = query({
  args: { secret, supplier_id: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    return records.getSupplierProfile(ctx, args.supplier_id);
  },
});

export const listSupplierProfiles = query({
  args: { secret },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    return records.listSupplierProfiles(ctx);
  },
});

export const getSupplierRecords = query({
  args: { secret, supplier_id: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    return records.getSupplierRecords(ctx, args.supplier_id);
  },
});

// ---------- inbound ----------

export const startInboundCall = mutation({
  args: { secret, call_id: v.string(), caller_number: v.string() },
  handler: async (ctx, args) => {
    assertVoiceSecret(args.secret);
    if (await findInbound(ctx, args.call_id)) return;
    await ctx.db.insert("inboundCalls", {
      call_id: args.call_id,
      caller_number: args.caller_number,
      claimed_identity: UNKNOWN_CALLER,
      requested: "",
      transcript: [],
      receivedAt: new Date().toISOString(),
      status: "in_progress",
      asked_bank_change: false,
    });
  },
});

/**
 * Closes the inbound record. On a bank-change request for a known supplier, queues a check call
 * to that supplier's phone_on_file. The caller's number is never dialed. Idempotent.
 */
export const finishInboundCall = mutation({
  args: { secret, record: inboundRecord },
  handler: async (ctx, args): Promise<{ triggered_call_id: string | null }> => {
    assertVoiceSecret(args.secret);
    const rec = args.record;
    const existing = await findInbound(ctx, rec.call_id);
    if (existing?.status === "ended") return { triggered_call_id: existing.triggered_call_id ?? null };

    let triggered_call_id: string | undefined;
    const supplier = rec.claimed_supplier_id
      ? await records.getSupplierProfile(ctx, rec.claimed_supplier_id)
      : null;
    if (rec.asked_bank_change && supplier) {
      const req = followUpRequest(rec, supplier);
      if (!(await findRequest(ctx, req.call_id))) await ctx.db.insert("callRequests", req);
      triggered_call_id = req.call_id;
    }

    const fields = {
      claimed_identity: rec.claimed_identity || UNKNOWN_CALLER,
      claimed_supplier_id: rec.claimed_supplier_id,
      requested: rec.requested,
      asked_bank_change: rec.asked_bank_change,
      transcript: rec.transcript.map((l) => ({
        speaker: l.speaker === "callback" ? ("callback" as const) : ("caller" as const),
        text: l.text,
        ts: l.ts,
      })),
      triggered_call_id,
      status: "ended" as const,
      endedAt: new Date().toISOString(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("inboundCalls", {
        ...fields,
        call_id: rec.call_id,
        caller_number: rec.caller_number,
        receivedAt: new Date().toISOString(),
      });
    return { triggered_call_id: triggered_call_id ?? null };
  },
});
