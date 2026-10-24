// After a call to Fogline's line ends, read the transcript against the playbook's phone tactics.
// A suspicious call is marked on the Phone line with the evidence, and when the caller claimed to
// be a supplier, hold calls that supplier back on the number on file, even if the caller never
// asked outright to change bank details. Nothing is ever changed because of a call.
import { v } from "convex/values";
import { internal } from "../_generated/api.js";
import { internalAction, internalMutation, internalQuery } from "../_generated/server.js";
import { forChannel, techniqueCheck } from "../../lib/fraudTechniques.js";
import type { InboundCallRecord } from "../../shared/contract.js";
import { anthropic, assessCall, loadPlaybook, transcriptText } from "../app/techniques.js";
import * as records from "./records.js";
import { followUpRequest } from "./rules.js";

export const callForScreen = internalQuery({
  args: { call_id: v.string() },
  handler: async (ctx, { call_id }) => {
    const call = await ctx.db
      .query("inboundCalls")
      .withIndex("by_key", (q) => q.eq("call_id", call_id))
      .unique();
    return call ? { call, playbook: forChannel(await loadPlaybook(ctx), "phone") } : null;
  },
});

export const screen = internalAction({
  args: { call_id: v.string() },
  handler: async (ctx, { call_id }) => {
    const found = await ctx.runQuery(internal.voice.callScreen.callForScreen, { call_id });
    if (!found || found.call.fraud) return;
    const transcript = transcriptText(found.call.transcript);
    if (!found.call.transcript.some((t) => t.speaker === "caller")) return; // the caller never spoke
    const a = await assessCall(anthropic(), { transcript, callerNumber: found.call.caller_number }, found.playbook);
    const check = techniqueCheck(a, found.playbook, found.call.caller_number);
    await ctx.runMutation(internal.voice.callScreen.recordVerdict, {
      call_id,
      state: check.state === "flag" ? "flag" : "pass",
      evidence: check.evidence,
      quote: check.quote,
      techniqueKeys: a.matches.map((m) => m.techniqueKey),
    });
  },
});

export const recordVerdict = internalMutation({
  args: {
    call_id: v.string(),
    state: v.union(v.literal("flag"), v.literal("pass")),
    evidence: v.string(),
    quote: v.optional(v.string()),
    techniqueKeys: v.array(v.string()),
  },
  handler: async (ctx, { call_id, ...verdict }) => {
    const call = await ctx.db
      .query("inboundCalls")
      .withIndex("by_key", (q) => q.eq("call_id", call_id))
      .unique();
    if (!call || call.fraud) return;
    const evidence = verdict.evidence.replace(/^Doesn't match any of the (\d+) fraud techniques/, "Doesn't match any of the $1 phone tactics");
    const patch: Partial<typeof call> = { fraud: { ...verdict, evidence, assessedAt: new Date().toISOString() } };

    if (verdict.state === "flag") {
      // A suspicious call from someone claiming to be a supplier: confirm with the real one.
      const supplier = call.claimed_supplier_id ? await records.getSupplierProfile(ctx, call.claimed_supplier_id) : null;
      if (supplier && !call.triggered_call_id) {
        const record: InboundCallRecord = {
          call_id,
          caller_number: call.caller_number,
          claimed_identity: call.claimed_identity,
          claimed_supplier_id: call.claimed_supplier_id,
          requested: call.requested,
          asked_bank_change: call.asked_bank_change ?? false,
          transcript: call.transcript,
        };
        const req = followUpRequest(record, supplier, `Suspicious call to the phone line: ${evidence}`);
        await ctx.db.insert("callRequests", req);
        patch.triggered_call_id = req.call_id;
      }
      await ctx.db.insert("activity", {
        key: `act_${crypto.randomUUID()}`,
        actor: "callback",
        what: `flagged a call from ${call.caller_number} as suspicious`,
        why: evidence + (patch.triggered_call_id ? ` Calling ${supplier!.name} back on the number on file.` : ""),
        refKind: "inboundCall",
        refKey: call_id,
        at: new Date().toISOString(),
      });
    }
    await ctx.db.patch(call._id, patch);
  },
});
