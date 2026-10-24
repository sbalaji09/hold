// Queries and mutations for the team's screens (Live call, Phone line).
// They return the app's table rows as stored.
// TODO(auth): these are public until the app adds team login; then guard them with ctx.auth.
import { ConvexError, v } from "convex/values";
import { mentionsBankDetails, waitingForReview } from "../../shared/contract.js";
import { internal } from "../_generated/api.js";
import type { Doc } from "../_generated/dataModel.js";
import { mutation, query, type MutationCtx } from "../_generated/server.js";
import { getCompany } from "../app/company.js";
import { getSupplierContact } from "./records.js";
import { findRequest, findResult, toCallResult, trustIfConfirmedLive, writeResult } from "./server.js";
import { isClosed, reviewedResult, TAKEOVER_BEFORE_CONNECT_SUMMARY } from "./rules.js";

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

/** The most recently created call that is queued, dialing or in progress, for auto-opening the Live call screen. */
export const activeCall = query({
  args: {},
  handler: async (ctx) => {
    const latest = (status: "queued" | "dialing" | "in_progress") =>
      ctx.db
        .query("callRequests")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .first();
    const rows = await Promise.all([latest("queued"), latest("dialing"), latest("in_progress")]);
    return rows.reduce((a, r) => (r && (!a || r._creationTime > a._creationTime) ? r : a), null as (typeof rows)[number]);
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
        ).sort((a, b) => a.ts - b.ts);
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

const FOLLOW_UP_MAX = 200;

/**
 * Answers hold left for the approver's review (a check call whose result is needs_review), newest
 * first, for Today's "Needs your approval".
 */
export const answerReviews = query({
  args: {},
  handler: async (ctx) => {
    // ponytail: scans every result; index callResults by outcome if call history grows large.
    const results = (await ctx.db.query("callResults").collect()).filter((r) => r.outcome === "needs_review");
    const out = [];
    for (const r of results) {
      const request = await findRequest(ctx, r.call_id);
      if (!request) continue;
      const events = await ctx.db
        .query("callEvents")
        .withIndex("by_call", (q) => q.eq("call_id", r.call_id))
        .collect();
      const supplier = await getSupplierContact(ctx, request.supplier_id);
      for (const ask of waitingForReview(events)) {
        out.push({ call_id: r.call_id, bill_id: request.bill_id, ask_id: ask.ask_id, supplier: supplier?.name ?? request.supplier_id, ask: ask.ask, answer: ask.answer, at: r._creationTime });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  },
});

/**
 * The approver answers hold's question about an answer: mid-call on the Live call screen, where the
 * first reply wins and a late click is refused with the reason, or after the call when the answer
 * was left for their review.
 */
export const answerAsk = mutation({
  args: {
    call_id: v.string(),
    ask_id: v.string(),
    verdict: v.union(v.literal("matches"), v.literal("no_match"), v.literal("follow_up")),
    follow_up: v.optional(v.string()),
    actor: v.literal("dev"),
  },
  handler: async (ctx, { call_id, ask_id, verdict, follow_up, actor }) => {
    const request = await findRequest(ctx, call_id);
    if (!request) throw new ConvexError(`Unknown call ${call_id}.`);
    const events = await ctx.db
      .query("callEvents")
      .withIndex("by_call", (q) => q.eq("call_id", call_id))
      .collect();
    const ask = events.find((e) => e.type === "ask_person" && e.ask_id === ask_id);
    if (!ask || ask.type !== "ask_person") throw new ConvexError("hold didn't ask that on this call.");
    const result = await findResult(ctx, call_id);
    const reviewing = result?.outcome === "needs_review" && waitingForReview(events).some((e) => e.ask_id === ask_id);
    const replied = events.some((e) => e.type === "person_answer" && e.ask_id === ask_id);
    if (!reviewing && (isClosed(request.status) || replied)) {
      throw new ConvexError("hold already moved on from this question.");
    }
    const line = follow_up?.trim() ?? "";
    if (verdict === "follow_up") {
      if (!ask.follow_up_allowed) throw new ConvexError("hold already asked one follow-up. Say whether this answer matches.");
      if (!line) throw new ConvexError("Write the question for hold to ask.");
      if (line.length > FOLLOW_UP_MAX) throw new ConvexError(`Keep it under ${FOLLOW_UP_MAX} characters, one spoken question.`);
      if (mentionsBankDetails(line)) throw new ConvexError("hold never asks about bank or account details on a check call.");
      if (reviewing && waitingForReview(events).length > 1) {
        throw new ConvexError("Another answer from this call is waiting too. Decide that one first, then ask your question.");
      }
    }
    await ctx.db.insert("callEvents", {
      call_id,
      type: "person_answer",
      ask_id,
      verdict,
      by: actor,
      ...(verdict === "follow_up" ? { follow_up: line } : {}),
    });
    if (reviewing) await settleReview(ctx, request, result, ask, verdict, line);
    const said =
      verdict === "follow_up"
        ? reviewing
          ? `Asked hold to call back on the number on file and ask "${line}".`
          : `Asked hold to follow up with "${line}".`
        : `Said "${ask.answer}" ${verdict === "matches" ? "matches" : "doesn't match"} the records (${ask.source.ref}).`;
    await ctx.db.insert("activity", {
      key: `act_${crypto.randomUUID()}`,
      actor,
      what: reviewing ? "reviewed an answer from a check call" : "answered hold during a check call",
      why: said,
      refKind: "bill",
      refKey: request.bill_id,
      at: new Date().toISOString(),
    });
  },
});

/**
 * The approver's review of an answer that waited for them. A verdict decides the answer and, once
 * nothing else waits, the call and its bill. A question queues a call back to the same trusted
 * number that asks only that, carrying what this call already checked.
 */
async function settleReview(
  ctx: MutationCtx,
  request: Doc<"callRequests">,
  result: Doc<"callResults">,
  ask: Extract<Doc<"callEvents">, { type: "ask_person" }>,
  verdict: "matches" | "no_match" | "follow_up",
  line: string,
): Promise<void> {
  const bill = await ctx.db
    .query("bills")
    .withIndex("by_key", (q) => q.eq("key", request.bill_id))
    .unique();
  if (verdict === "follow_up") {
    await ctx.db.insert("callRequests", {
      call_id: `call_${crypto.randomUUID()}`,
      bill_id: request.bill_id,
      supplier_id: request.supplier_id,
      to_number: request.to_number, // the number this check already trusted, never a new one
      number_source: request.number_source,
      reason: [`Your follow-up question: ${line}`],
      status: "queued",
      attempt: 0,
      mode: request.mode ?? "live",
      follow_up: { ask: line, source: ask.source, carried: result.evidence.filter((e) => e.ask_id !== ask.ask_id) },
    });
    // The call back decides the bill now, through the usual Calling -> result path.
    if (bill?.status === "Needs you") await ctx.db.patch(bill._id, { status: "Calling" });
    return;
  }
  const next = reviewedResult(toCallResult(result), ask.ask_id, verdict === "matches", await getCompany(ctx));
  await ctx.db.patch(result._id, next);
  if (next.outcome === "needs_review") return;
  if (next.outcome === "confirmed") await trustIfConfirmedLive(ctx, request);
  await ctx.scheduler.runAfter(0, internal.app.callOutcome.applyCallResult, { call_id: request.call_id, reviewed: true });
}
