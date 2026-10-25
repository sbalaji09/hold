// Server-side actions Callback or the approver can take on a bill, including approve/reject.
// Every rule from lib/policy.ts is enforced here, not just in the UI, and every attempt —
// refused or not — writes an activity row with the reason. requestCall writes a callRequests row
// per plan-agent.md's "Interface contract" §1 (to_number only from the supplier's trusted phone;
// voice owns everything downstream of that row).
// TODO(auth): these are public until the app adds team login; then guard them with ctx.auth.
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server.js";
import type { Actor } from "../../lib/policy.js";
import type { Bill } from "../../lib/types.js";
import { canApprove, canCall, canHold, canMoveMoney, canPay, canPayChangedAccount, canRelease } from "../../lib/policy.js";
import { getWatchOnlySetting, hydrateBill } from "./queries.js";
import { getCompany } from "./company.js";
import { wholeDollars } from "../../lib/company.js";
import { routeEscalation } from "./checks.js";

const actorValidator = v.union(v.literal("callback"), v.literal("dev"));

async function requireBillRow(ctx: MutationCtx, billKey: string): Promise<Doc<"bills">> {
  const row = await ctx.db
    .query("bills")
    .withIndex("by_key", (q) => q.eq("key", billKey))
    .unique();
  if (!row) throw new ConvexError(`Unknown bill ${billKey}`);
  return row;
}

async function logActivity(
  ctx: MutationCtx,
  actor: Actor,
  what: string,
  why: string,
  refKind: string,
  refKey: string,
): Promise<void> {
  await ctx.db.insert("activity", {
    key: `act_${crypto.randomUUID()}`,
    actor,
    what,
    why,
    refKind,
    refKey,
    at: new Date().toISOString(),
  });
}

// A thrown error would roll back the activity row, so a refusal is a normal return: it writes the
// row (who tried what and why it was refused) and hands the reason back for the UI to show.
export type Refused = { refused: string };
async function refuse(ctx: MutationCtx, actor: Actor, what: string, reason: string, billKey: string): Promise<Refused> {
  await logActivity(ctx, actor, `was refused: ${what}`, reason, "bill", billKey);
  return { refused: reason };
}

// ---------- mutations ----------

/** Callback pays safe bills under $10k on its own; flagged or >=$10k bills are refused here. */
export const payBill = mutation({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => {
    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);
    const watchOnly = await getWatchOnlySetting(ctx);
    const co = await getCompany(ctx);
    const result = canPay(bill, watchOnly, co);
    if (!result.allowed) return refuse(ctx, "dev", "pay", result.reason!, billKey);
    await ctx.db.patch(row._id, { status: "Scheduled" });
    await logActivity(ctx, "callback", "scheduled payment", `Amount was under ${wholeDollars(co.approvalLimitCents)} and every check passed.`, "bill", billKey);
  },
});

/** Callback holds any bill that isn't already paid or held; also opens the pending approval Dev
 * needs to release it, routed per plan-agent.md addendum §2 (bank change or any other failed
 * check both go to Dev — nothing else holds a bill). */
export const holdBill = mutation({
  args: { billKey: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { billKey, reason }) => {
    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);
    const result = canHold(bill);
    if (!result.allowed) return refuse(ctx, "dev", "hold", result.reason!, billKey);
    await holdRow(ctx, row, bill, reason);
  },
});

/** Moves the bill to Held and
 * opens (or reuses) the pending approval Dev needs to release it. Never checks policy itself —
 * callers that need canHold's refusal path call it first. */
async function holdRow(ctx: MutationCtx, row: Doc<"bills">, bill: Bill, reason?: string): Promise<void> {
  const billKey = bill.key;
  const why = reason ?? bill.checks.filter((c) => c.state === "flag").map((c) => c.evidence).join(" ") ?? "A check on this bill didn't pass.";
  const route = routeEscalation(bill.checks, bill.amountCents, { callOutcome: bill.call?.outcome ?? null });
  const kind = bill.checks.find((c) => c.id === "bank-account" && c.state === "flag") ? "bank_change" : "held_payment";
  await ctx.db.patch(row._id, { status: "Held" });
  const existingApproval = await ctx.db
    .query("approvals")
    .withIndex("by_bill", (q) => q.eq("billKey", billKey))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .first();
  if (!existingApproval) {
    await ctx.db.insert("approvals", {
      key: `appr_${crypto.randomUUID()}`,
      billKey,
      kind,
      status: "pending",
      recommendation: `Hold this payment. ${why}`,
      routedTo: route.routedTo,
      reason: route.reason,
      thread: [],
    });
  }
  await logActivity(ctx, "callback", "held this bill", why || "A check on this bill didn't pass.", "bill", billKey);
}

/**
 * Writes a call request to the supplier's number on file (never the email), per the interface
 * contract §1. Voice claims it and drives it from there.
 */
export const requestCall = mutation({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => {
    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);
    const watchOnly = await getWatchOnlySetting(ctx);
    const result = canCall(bill, watchOnly);
    if (!result.allowed) return refuse(ctx, "dev", "call supplier", result.reason!, billKey);

    const supplier = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", bill.supplierKey))
      .unique();
    if (!supplier) throw new ConvexError(`Unknown supplier ${bill.supplierKey}`);
    if (!supplier.trustedPhone) {
      return refuse(ctx, "dev", "call supplier", "No number on file yet. Run the background check and confirm a number first.", billKey);
    }

    // A call is already in flight for this bill: don't queue a second one, just hand back the
    // one already running (no-op, no extra activity row).
    const existingCalls = await ctx.db
      .query("callRequests")
      .withIndex("by_bill", (q) => q.eq("bill_id", bill.key))
      .collect();
    const activeCall = existingCalls.find((c) => c.status === "queued" || c.status === "dialing" || c.status === "in_progress");
    if (activeCall) {
      return activeCall.call_id;
    }

    const co = await getCompany(ctx);
    const reason = bill.checks.filter((c) => c.state === "flag").map((c) => c.label);
    const call_id = `call_${crypto.randomUUID()}`;
    await ctx.db.insert("callRequests", {
      call_id,
      bill_id: bill.key,
      supplier_id: supplier.key,
      to_number: supplier.trustedPhone,
      number_source: "on_file",
      reason: reason.length > 0 ? reason : [`Confirming this ${co.bill.one}`],
      status: "queued",
      attempt: 0,
      mode: "live",
    });
    await ctx.db.patch(row._id, { status: "Calling" });
    await logActivity(
      ctx,
      "callback",
      `called ${supplier.name} to verify this ${co.bill.one}`,
      reason.length > 0 ? reason.join("; ") : `Confirming this ${co.bill.one}.`,
      "bill",
      billKey,
    );
    return call_id;
  },
});

/**
 * Decides a pending approval (big payment, held payment or bank change).
 * Approving a held/bank-change bill also runs canRelease: a bank change needs a confirmed call.
 * `actor` accepts "callback" too, even though the UI never sends it, so the server (not just the
 * mutation's own type) is what refuses a self-approval.
 */
export const decideApproval = mutation({
  args: {
    billKey: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    actor: actorValidator,
    payToBankAccountKey: v.optional(v.string()),
  },
  handler: async (ctx, { billKey, decision, actor, payToBankAccountKey }) => {
    const approvalRow = await ctx.db
      .query("approvals")
      .withIndex("by_bill", (q) => q.eq("billKey", billKey))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (!approvalRow) throw new ConvexError(`No pending approval for bill ${billKey}`);

    const co = await getCompany(ctx);
    const approveCheck = canApprove(actor, "callback", co);
    if (!approveCheck.allowed) return refuse(ctx, actor, "approve", approveCheck.reason!, billKey);

    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);

    if (decision === "approve") {
      const moneyCheck = canMoveMoney(await getWatchOnlySetting(ctx));
      if (!moneyCheck.allowed) return refuse(ctx, actor, "approve", moneyCheck.reason!, billKey);
      if (payToBankAccountKey !== undefined) {
        const target = await ctx.db
          .query("bankAccounts")
          .withIndex("by_key", (q) => q.eq("key", payToBankAccountKey))
          .unique();
        if (!target || target.supplierKey !== bill.supplierKey) {
          return refuse(ctx, actor, "approve", `That bank account isn't on file for this ${co.payee.one}.`, billKey);
        }
        if (target.key === bill.bankAccountKey) {
          return refuse(ctx, actor, "approve", "That's the account already on this bill, not the verified alternative.", billKey);
        }
        if (target.status !== "active") {
          return refuse(ctx, actor, "approve", "That account isn't a verified account on file.", billKey);
        }
        await ctx.db.patch(row._id, { bankAccountKey: target.key, status: "Scheduled" });
        await ctx.db.patch(approvalRow._id, { status: "approved" });
        await logActivity(
          ctx,
          actor,
          "approved paying the verified account",
          bill.call?.outcome
            ? `Call outcome: ${bill.call.outcome}. Paying ${target.bank} \u00b7\u00b7${target.last4} instead of the unverified account.`
            : `Paying ${target.bank} \u00b7\u00b7${target.last4}, the ${co.payee.one}'s verified account on file.`,
          "bill",
          billKey,
        );
        return;
      }
      // A changed bank account needs a confirmed call whatever the status: a handed-off call leaves
      // the bill on "Needs you", and approving it must not pay an account nobody confirmed.
      const release = bill.status === "Held" ? canRelease(bill, actor, co) : canPayChangedAccount(bill, co);
      if (!release.allowed) return refuse(ctx, actor, "approve", release.reason!, billKey);
      // Dev approved a bank change after a confirmed call (checked just above): that account is now
      // verified, so a saved rule for it can stop the same change being asked about again (checks.ts).
      if (bill.checks.find((c) => c.id === "bank-account")?.state === "flag") {
        const acct = await ctx.db.query("bankAccounts").withIndex("by_key", (q) => q.eq("key", bill.bankAccountKey)).unique();
        if (acct) await ctx.db.patch(acct._id, { verifiedBy: "call+dev" });
      }
      await ctx.db.patch(approvalRow._id, { status: "approved" });
      await ctx.db.patch(row._id, { status: "Scheduled" });
      await logActivity(ctx, actor, "approved this bill", "Approved for payment.", "bill", billKey);
    } else {
      await ctx.db.patch(approvalRow._id, { status: "rejected" });
      await logActivity(ctx, actor, "rejected this bill", "Rejected; payment withheld.", "bill", billKey);
    }
  },
});

/** Flips the global Watch only setting from the Payments page. On: Callback still flags bills but
 * won't call suppliers or move money (lib/policy.ts's canMoveMoney gates both). Logged to
 * activity either way. */
export const setWatchOnly = mutation({
  args: { watchOnly: v.boolean(), actor: v.literal("dev") },
  handler: async (ctx, { watchOnly, actor }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (row) await ctx.db.patch(row._id, { watchOnly });
    else await ctx.db.insert("settings", { key: "global", watchOnly });
    await logActivity(
      ctx,
      actor,
      watchOnly ? "turned Watch only on" : "turned Watch only off",
      watchOnly ? "hold will flag bills but won't call suppliers or move money." : "hold can call suppliers and move money again.",
      "settings",
      "global",
    );
  },
});

/**
 * The approver says they're out (Today's header). While away, hold never puts a supplier on hold to
 * ask them mid-call: unsure answers wait on Today for review instead. Logged to activity either way.
 */
export const setAway = mutation({
  args: { away: v.boolean(), actor: v.literal("dev") },
  handler: async (ctx, { away, actor }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (row) await ctx.db.patch(row._id, { away });
    else await ctx.db.insert("settings", { key: "global", watchOnly: false, away });
    await logActivity(
      ctx,
      actor,
      away ? "set yourself away" : "set yourself available",
      away
        ? "hold won't ask you during calls. Answers it can't judge wait on Today for your review."
        : "hold asks you during calls again when it can't judge an answer.",
      "settings",
      "global",
    );
  },
});

/**
 * Atomically claims a bill for payment before the Increase action sends a transfer: verifies the
 * bill is Scheduled with no payment already pending or sent, and inserts a 'pending' payments row
 * in the same transaction. A concurrent second run of the same bill is refused here, not after
 * the transfer has already gone out.
 */
export const claimPayment = internalMutation({
  args: { billKey: v.string(), bankAccountKey: v.string(), amountCents: v.number() },
  handler: async (ctx, { billKey, bankAccountKey, amountCents }) => {
    const row = await requireBillRow(ctx, billKey);
    if (row.status !== "Scheduled") {
      return refuse(ctx, "callback", "claim payment", `Bill ${billKey} isn't scheduled to pay (status: ${row.status}).`, billKey);
    }
    // Every transfer passes through here, so this is where Watch only is enforced.
    const moneyCheck = canMoveMoney(await getWatchOnlySetting(ctx));
    if (!moneyCheck.allowed) return refuse(ctx, "callback", "claim payment", moneyCheck.reason!, billKey);
    const existing = await ctx.db
      .query("payments")
      .withIndex("by_bill", (q) => q.eq("billKey", billKey))
      .collect();
    if (existing.some((p) => p.status === "pending" || p.status === "sent")) {
      return refuse(ctx, "callback", "claim payment", `A payment for ${billKey} is already pending or sent.`, billKey);
    }
    const paymentKey = `pay_${crypto.randomUUID()}`;
    await ctx.db.insert("payments", {
      key: paymentKey,
      billKey,
      amountCents,
      bankAccountKey,
      status: "pending",
      paidAt: "",
    });
    return { paymentKey };
  },
});

/** The daily payment run (convex/app/increase.ts) couldn't pay a bill; nobody was watching, so it
 * goes in the Activity log. The bill stays Scheduled and the next run tries again. */
export const logPaymentFailure = internalMutation({
  args: { billKey: v.string(), error: v.string() },
  handler: async (ctx, { billKey, error }) => {
    await logActivity(ctx, "callback", "couldn't send a scheduled payment", error, "bill", billKey);
  },
});

/** Marks a claimed payment row 'failed' after a transfer attempt errors, leaving the bill
 * Scheduled so a retry can claim again. */
export const failPayment = internalMutation({
  args: { paymentKey: v.string() },
  handler: async (ctx, { paymentKey }) => {
    const row = await ctx.db
      .query("payments")
      .withIndex("by_key", (q) => q.eq("key", paymentKey))
      .unique();
    if (!row) throw new ConvexError(`Unknown payment ${paymentKey}`);
    await ctx.db.patch(row._id, { status: "failed" });
  },
});

/**
 * Writes the payment record once the Increase sandbox transfer has gone through (called by the
 * Increase action, not from the UI directly). The bill must already be Scheduled: payBill or an
 * approved decideApproval is what gets it there. Finalises the 'pending' row claimPayment already
 * inserted, instead of inserting a second one.
 */
export const recordPayment = internalMutation({
  args: {
    billKey: v.string(),
    paymentKey: v.string(),
    bankAccountKey: v.string(),
    amountCents: v.number(),
    transferId: v.optional(v.string()),
  },
  handler: async (ctx, { billKey, paymentKey, bankAccountKey, amountCents, transferId }) => {
    const row = await requireBillRow(ctx, billKey);
    if (row.status !== "Scheduled") {
      throw new ConvexError(`Bill ${billKey} isn't scheduled to pay (status: ${row.status}).`);
    }
    const paymentRow = await ctx.db
      .query("payments")
      .withIndex("by_key", (q) => q.eq("key", paymentKey))
      .unique();
    if (!paymentRow || paymentRow.status !== "pending") {
      throw new ConvexError(`Payment ${paymentKey} isn't a pending claim for ${billKey}.`);
    }
    const paidAt = new Date().toISOString();
    await ctx.db.patch(paymentRow._id, { status: "sent", transferId, paidAt, amountCents, bankAccountKey });
    await ctx.db.patch(row._id, { status: "Paid" });
    const bank = await ctx.db
      .query("bankAccounts")
      .withIndex("by_key", (q) => q.eq("key", bankAccountKey))
      .unique();
    await logActivity(
      ctx,
      "callback",
      `paid ${(amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} to ${bank ? bank.bank + " ··" + bank.last4 : "the account on file"}`,
      transferId ? `Sent through the Increase sandbox (transfer ${transferId}).` : "Sent through the Increase sandbox.",
      "bill",
      billKey,
    );
  },
});
