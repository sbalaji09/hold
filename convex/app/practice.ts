// Scam-replay helpers (gatherRow, firedChecks) and the regression table (practiceScams) that
// hold's self-improvement loop (convex/app/jobs/fraud.ts) and the check-call outcome handler
// (convex/app/callOutcome.ts) depend on. The old Practice screen (manual "Run"/"Generate new
// set" buttons, Claude-written scams) is gone; the Impact page (convex/app/impact.ts) replaces
// it with a fixed, judge-facing fixture run through the same checks. See product-brief.md.
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server.js";
// convex/app/checks.ts is owned by another agent; its signature per the
// contract we agreed on is:
//   runChecks({ email, supplier, currentBankAccount, pastPaidBankAccounts,
//               pastPaidAmounts, amountCents, styleMatch? }) -> Check[]
//   decide(checks, amountCents) -> "pay" | "ask_dev" | "call"
import { runChecks } from "./checks.js";

// Exported as a test seam: `addToPracticeSet` dedupes scams by this truncated description, so
// the truncation rule lives in one place.
export function descriptionFromBody(body: string): string {
  return body.slice(0, 160);
}

// ---------- shared row assembly (list, addToPracticeSet) ----------

/** Everything runChecks/decide need for one bill, read straight from the live
 * tables (never a separate "practice copy" table — a plain read is already a
 * copy: this never writes bills/payments/callRequests). Shared by the list
 * screen (to show which check fires right now), the full-set run, and
 * "Add to practice set" (to snapshot which checks should fire). */
export async function gatherRow(
  ctx: QueryCtx | MutationCtx,
  billKey: string,
): Promise<Omit<PracticeRunRow, "scamKey"> | null> {
  const bill = await ctx.db
    .query("bills")
    .withIndex("by_key", (q) => q.eq("key", billKey))
    .unique();
  if (!bill) return null;
  const email = await ctx.db
    .query("emails")
    .withIndex("by_key", (q) => q.eq("key", bill.emailKey))
    .unique();
  const supplier = await ctx.db
    .query("suppliers")
    .withIndex("by_key", (q) => q.eq("key", bill.supplierKey))
    .unique();
  const bankAccount = await ctx.db
    .query("bankAccounts")
    .withIndex("by_key", (q) => q.eq("key", bill.bankAccountKey))
    .unique();
  if (!email || !supplier || !bankAccount) return null;

  let confirmedByCall = false;
  if (bankAccount.verifiedBy === "call+dev") {
    const callReq = await ctx.db
      .query("callRequests")
      .withIndex("by_bill", (q) => q.eq("bill_id", bill.key))
      .first();
    if (callReq) {
      const result = await ctx.db
        .query("callResults")
        .withIndex("by_call", (q) => q.eq("call_id", callReq.call_id))
        .unique();
      confirmedByCall = result?.outcome === "confirmed";
    }
  }

  const supplierBills = await ctx.db
    .query("bills")
    .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier.key))
    .collect();
  const pastPaid = supplierBills.filter((b) => b.status === "Paid" && b.key !== bill.key);
  const pastPaidBankAccounts: Array<{ bank: string; last4: string }> = [];
  for (const paid of pastPaid) {
    const acct = await ctx.db
      .query("bankAccounts")
      .withIndex("by_key", (q) => q.eq("key", paid.bankAccountKey))
      .unique();
    pastPaidBankAccounts.push({ bank: acct?.bank ?? "", last4: acct?.last4 ?? "" });
  }

  return {
    email: { fromAddress: email.fromAddress, fromDomain: email.fromDomain, body: email.body },
    supplier: { key: supplier.key, name: supplier.name, domain: supplier.domain },
    currentBankAccount: { bank: bankAccount.bank, last4: bankAccount.last4, verifiedBy: bankAccount.verifiedBy, confirmedByCall },
    pastPaidBankAccounts,
    pastPaidAmounts: pastPaid.map((b) => b.amountCents),
    amountCents: bill.amountCents,
  };
}

/** Check ids/labels that currently flag for a row — "which check fired", shown
 * on the Practice screen without needing a stored field (always reflects the
 * live data, same as a fresh run would see). */
function firedChecks(row: Omit<PracticeRunRow, "scamKey">): string[] {
  return runChecks(row)
    .filter((c) => c.state === "flag")
    .map((c) => c.label);
}

// ---------- list (Practice screen) ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const scams = await ctx.db.query("practiceScams").collect();
    const rows = await Promise.all(
      scams.map(async (scam) => {
        const row = await gatherRow(ctx, scam.billKey);
        return {
          key: scam.key,
          billKey: scam.billKey,
          kind: scam.kind,
          description: scam.description,
          checksThatShouldFire: scam.checksThatShouldFire,
          checksFiredNow: row ? firedChecks(row) : [],
          from: row?.email.fromAddress ?? "(bill not found)",
          caughtLastRun: scam.caughtLastRun ?? null,
          lastRunAt: scam.lastRunAt ?? null,
        };
      }),
    );
    return rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  },
});

// ---------- today stats (Today's "How hold is doing" card) ----------

export interface TodayStats {
  billsChecked: number;
  scamsHeld: number;
  falseHoldsOverridden: number;
  bankChangesConfirmed: number;
  moneyHeldCents: number;
  avgCallSeconds: number | null;
}

/** Honest numbers for Today's "How hold is doing" card, computed straight from the real
 * tables. The fixed-fixture numbers (money held back, scams caught) live on the Impact screen
 * (lib/impact.ts), computed locally and not part of this query. */
export const todayStats = query({
  args: {},
  handler: async (ctx): Promise<TodayStats> => {
    const [bills, approvals, bankAccounts] = await Promise.all([
      ctx.db.query("bills").collect(),
      ctx.db.query("approvals").collect(),
      ctx.db.query("bankAccounts").collect(),
    ]);
    const realBills = bills.filter((b) => !b.practice);
    const realBillKeys = new Set(realBills.map((b) => b.key));
    const heldApprovals = approvals.filter((a) => a.kind === "held_payment" && realBillKeys.has(a.billKey));

    // Finished, non-Practice calls: length = last transcript segment's end_ts (seconds from
    // call start), averaged across every call that has a result.
    const [callRequests, callResults] = await Promise.all([ctx.db.query("callRequests").collect(), ctx.db.query("callResults").collect()]);
    const liveDoneCallIds = new Set(
      callRequests.filter((c) => c.mode !== "simulated" && realBillKeys.has(c.bill_id)).map((c) => c.call_id),
    );
    const lengths: number[] = [];
    for (const r of callResults) {
      if (!liveDoneCallIds.has(r.call_id)) continue;
      const events = await ctx.db
        .query("callEvents")
        .withIndex("by_call", (q) => q.eq("call_id", r.call_id))
        .collect();
      const end = events.reduce((max, e) => (e.type === "segment" ? Math.max(max, e.end_ts ?? e.ts) : max), 0);
      if (end > 0) lengths.push(end);
    }

    return {
      billsChecked: realBills.length,
      scamsHeld: heldApprovals.length,
      falseHoldsOverridden: heldApprovals.filter((a) => a.status === "approved").length,
      bankChangesConfirmed: bankAccounts.filter((a) => a.verifiedBy === "call+dev").length,
      moneyHeldCents: realBills.filter((b) => b.status === "Held").reduce((sum, b) => sum + b.amountCents, 0),
      avgCallSeconds: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null,
    };
  },
});

// ---------- add to practice set (any bill, e.g. one Callback missed) ----------

/** Adds a bill to the regression suite. Shared by "Add to practice set" and "Report missed scam". */
export async function addBillToPracticeSet(ctx: MutationCtx, billKey: string, kind = "from bill"): Promise<{ key: string }> {
  const bill = await ctx.db
    .query("bills")
    .withIndex("by_key", (q) => q.eq("key", billKey))
    .unique();
  if (!bill) throw new Error(`addToPracticeSet: no bill ${billKey}`);
  const row = await gatherRow(ctx, billKey);
  if (!row) throw new Error(`addToPracticeSet: bill ${billKey} is missing its email, supplier, or bank account`);
  const scamKey = `scam_frombill_${bill.key}_${Date.now()}`;
  await ctx.db.insert("practiceScams", {
    key: scamKey,
    billKey,
    kind,
    description: descriptionFromBody(row.email.body),
    checksThatShouldFire: firedChecks(row),
  });
  return { key: scamKey };
}

export const addToPracticeSet = mutation({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => addBillToPracticeSet(ctx, billKey),
});

// ---------- shared row shape for self-improvement replay (convex/app/jobs/fraud.ts) ----------

/** Everything runChecks/decide need for one scam, read straight from the
 * live tables (never a separate "practice copy" table — a plain read is
 * already a copy: this never writes bills/payments/callRequests). */
export interface PracticeRunRow {
  scamKey: string;
  billKey?: string;
  email: { fromAddress: string; fromDomain: string; body: string };
  supplier: { key: string; name: string; domain: string };
  currentBankAccount: { bank: string; last4: string; verifiedBy: "onboarding" | "call+dev"; confirmedByCall: boolean };
  pastPaidBankAccounts: Array<{ bank: string; last4: string }>;
  pastPaidAmounts: number[];
  amountCents: number;
}
