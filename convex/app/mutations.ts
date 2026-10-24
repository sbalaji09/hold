// Server-side actions a bookkeeper (or Callback itself) can take on a bill, plus Dev's approve/
// reject. Every rule from lib/policy.ts is enforced here, not just in the UI, and every attempt —
// refused or not — writes an activity row with the reason. requestCall writes a callRequests row
// per plan-agent.md's "Interface contract" §1 (to_number only from the supplier's trusted phone;
// voice owns everything downstream of that row).
// TODO(auth): these are public until the app adds team login; then guard them with ctx.auth.
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import { mutation, type MutationCtx } from "../_generated/server.js";
import type { Actor } from "../../lib/policy.js";
import { canApprove, canCall, canHold, canPay, canRelease } from "../../lib/policy.js";
import { hydrateBill } from "./queries.js";

const actorValidator = v.union(v.literal("callback"), v.literal("maya"), v.literal("dev"));

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

// A thrown error rolls back every write this transaction made (Convex mutations are atomic), so a
// refusal can only ever report the reason — it can't also leave an activity row behind. Only
// successful actions are logged.
function refuse(reason: string): never {
  throw new ConvexError(reason);
}

// ---------- mutations ----------

/** Callback pays safe bills under $10k on its own; flagged or >=$10k bills are refused here. */
export const payBill = mutation({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => {
    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);
    const result = canPay(bill);
    if (!result.allowed) return refuse(result.reason!);
    await ctx.db.patch(row._id, { status: "Scheduled" });
    await logActivity(ctx, "callback", "scheduled payment", "Amount was under $10,000 and every check passed.", "bill", billKey);
  },
});

/** Callback holds any bill that isn't already paid or held. */
export const holdBill = mutation({
  args: { billKey: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { billKey, reason }) => {
    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);
    const result = canHold(bill);
    if (!result.allowed) return refuse(result.reason!);
    const why = reason ?? bill.checks.filter((c) => c.state === "flag").map((c) => c.evidence).join(" ") ?? "A check on this bill didn't pass.";
    await ctx.db.patch(row._id, { status: "Held" });
    await logActivity(ctx, "callback", "held this bill", why || "A check on this bill didn't pass.", "bill", billKey);
  },
});

/**
 * Writes a call request to the supplier's number on file (never the email), per the interface
 * contract §1. Voice claims it and drives it from there.
 */
export const requestCall = mutation({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => {
    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);
    const result = canCall(bill);
    if (!result.allowed) return refuse(result.reason!);

    const supplier = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", bill.supplierKey))
      .unique();
    if (!supplier) throw new ConvexError(`Unknown supplier ${bill.supplierKey}`);

    const reason = bill.checks.filter((c) => c.state === "flag").map((c) => c.label);
    const call_id = `call_${crypto.randomUUID()}`;
    await ctx.db.insert("callRequests", {
      call_id,
      bill_id: bill.key,
      supplier_id: supplier.key,
      to_number: supplier.trustedPhone,
      number_source: "on_file",
      reason: reason.length > 0 ? reason : ["Maya asked to confirm this bill"],
      status: "queued",
      attempt: 0,
      mode: "live",
    });
    await ctx.db.patch(row._id, { status: "Calling" });
    await logActivity(
      ctx,
      "callback",
      `called ${supplier.name} to verify this bill`,
      reason.length > 0 ? reason.join("; ") : "Maya asked to confirm this bill.",
      "bill",
      billKey,
    );
    return call_id;
  },
});

/**
 * Dev or Maya decides a pending approval (big payment, held payment or bank change). Only Dev can
 * approve: Maya can see and discuss, never sign off (plan-agent.md "Decision and limits").
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

    const approveCheck = canApprove(actor, "callback");
    if (!approveCheck.allowed) return refuse(approveCheck.reason!);
    if (actor !== "dev") {
      return refuse("Maya can't approve this. Dev has to sign off.");
    }

    const row = await requireBillRow(ctx, billKey);
    const bill = await hydrateBill(ctx, row);

    if (decision === "approve") {
      if (payToBankAccountKey !== undefined) {
        const target = await ctx.db
          .query("bankAccounts")
          .withIndex("by_key", (q) => q.eq("key", payToBankAccountKey))
          .unique();
        if (!target || target.supplierKey !== bill.supplierKey) {
          return refuse("That bank account isn't on file for this supplier.");
        }
        if (target.key === bill.bankAccountKey) {
          return refuse("That's the account already on this bill, not the verified alternative.");
        }
        if (target.status !== "active") {
          return refuse("That account isn't a verified account on file.");
        }
        await ctx.db.patch(row._id, { bankAccountKey: target.key, status: "Scheduled" });
        await ctx.db.patch(approvalRow._id, { status: "approved" });
        await logActivity(
          ctx,
          actor,
          "approved paying the verified account",
          bill.call?.outcome
            ? `Call outcome: ${bill.call.outcome}. Paying ${target.bank} \u00b7\u00b7${target.last4} instead of the unverified account.`
            : `Paying ${target.bank} \u00b7\u00b7${target.last4}, the supplier's verified account on file.`,
          "bill",
          billKey,
        );
        return;
      }
      if (bill.status === "Held") {
        const release = canRelease(bill, actor);
        if (!release.allowed) return refuse(release.reason!);
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

/**
 * Writes the payment record once the Increase sandbox transfer has gone through (called by the
 * Increase action, not from the UI directly). The bill must already be Scheduled: payBill or an
 * approved decideApproval is what gets it there.
 */
export const recordPayment = mutation({
  args: {
    billKey: v.string(),
    bankAccountKey: v.string(),
    amountCents: v.number(),
    transferId: v.optional(v.string()),
  },
  handler: async (ctx, { billKey, bankAccountKey, amountCents, transferId }) => {
    const row = await requireBillRow(ctx, billKey);
    if (row.status !== "Scheduled") {
      throw new ConvexError(`Bill ${billKey} isn't scheduled to pay (status: ${row.status}).`);
    }
    const paidAt = new Date().toISOString();
    await ctx.db.insert("payments", {
      key: `pay_${crypto.randomUUID()}`,
      billKey,
      amountCents,
      bankAccountKey,
      status: "sent",
      transferId,
      paidAt,
    });
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
