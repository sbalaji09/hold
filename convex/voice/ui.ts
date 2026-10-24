// Queries and mutations for the team's screens (Live call, Phone line).
// They return the app's table rows as stored.
// TODO(auth): these are public until the app adds team login; then guard them with ctx.auth.
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import { mutation, query } from "../_generated/server.js";
import { getSupplierContact } from "./records.js";
import { TAKEOVER_BEFORE_CONNECT_SUMMARY } from "./rules.js";
import { findRequest, findResult, writeResult } from "./server.js";

/**
 * Everything the Live call screen shows for one call. Events are in creation order.
 * `supplier` gives display names (title, speaker label); null if the request or supplier is unknown.
 */
export const liveCall = query({
  args: { call_id: v.string() },
  handler: async (ctx, { call_id }) => {
    const [request, events, result] = await Promise.all([
      findRequest(ctx, call_id),
      ctx.db
        .query("callEvents")
        .withIndex("by_call", (q) => q.eq("call_id", call_id))
        .collect(),
      findResult(ctx, call_id),
    ]);
    const supplier = request ? await getSupplierContact(ctx, request.supplier_id) : null;
    return { request, events, result, supplier };
  },
});

/** The most recently created call that is dialing or in progress, for auto-opening the Live call screen. */
export const activeCall = query({
  args: {},
  handler: async (ctx) => {
    const latest = (status: "dialing" | "in_progress") =>
      ctx.db
        .query("callRequests")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .first();
    const [dialing, inProgress] = await Promise.all([latest("dialing"), latest("in_progress")]);
    if (!dialing || !inProgress) return dialing ?? inProgress;
    return dialing._creationTime > inProgress._creationTime ? dialing : inProgress;
  },
});

/**
 * Phone line screen: Fogline's number, live incoming calls and past calls (newest first).
 * A live call's transcript is built from its segment events, since the record's transcript
 * is only written when the call ends. Seeded historical rows have no status and count as past.
 */
export const phoneLine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const take = Math.max(1, Math.min(limit ?? 50, 200));
    const newestFirst = () => ctx.db.query("inboundCalls").withIndex("by_received").order("desc");
    const activeRows = await newestFirst()
      .filter((q) => q.eq(q.field("status"), "in_progress"))
      .take(take);
    const active: Doc<"inboundCalls">[] = await Promise.all(
      activeRows.map(async (row) => {
        const events = await ctx.db
          .query("callEvents")
          .withIndex("by_call", (q) => q.eq("call_id", row.call_id))
          .collect();
        const transcript = events.flatMap((e) =>
          e.type === "segment"
            ? [{ speaker: e.speaker === "callback" ? ("callback" as const) : ("caller" as const), text: e.text, ts: e.ts }]
            : [],
        );
        return { ...row, transcript };
      }),
    );
    const past = await newestFirst()
      .filter((q) => q.neq(q.field("status"), "in_progress"))
      .take(take);
    return { number: process.env.TWILIO_PHONE_NUMBER ?? null, active, past };
  },
});

/**
 * "End call and take over" on the Live call screen.
 * During a call the voice server watches the flag, hangs up and writes the handed_off result with
 * the evidence it heard. With no call running (waiting to dial or to retry) nobody would, so the
 * hand-off is written here.
 */
export const requestTakeover = mutation({
  args: { call_id: v.string() },
  handler: async (ctx, { call_id }) => {
    const row = await findRequest(ctx, call_id);
    if (!row) throw new Error(`Unknown call request ${call_id}`);
    if (!row.takeover_requested) await ctx.db.patch(row._id, { takeover_requested: true });
    if (row.status === "queued" || row.status === "retry_scheduled") {
      await writeResult(ctx, { call_id, outcome: "handed_off", evidence: [], summary: TAKEOVER_BEFORE_CONNECT_SUMMARY });
    }
  },
});
