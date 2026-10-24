// Moves a bill once its check call has a result (Calling -> Held / Needs you / Scheduled).
// Scheduled by convex/voice/server.ts's writeResult right after the result is saved, so a problem
// here can never lose the call result itself. The rules live in lib/callOutcome.ts.
import { v } from "convex/values";
import { internal } from "../_generated/api.js";
import { internalMutation } from "../_generated/server.js";
import { decideCallOutcome, sentence } from "../../lib/callOutcome.js";
import { getCompany } from "./company.js";
import { hydrateBill } from "./queries.js";
import { addBillToPracticeSet } from "./practice.js";
import { openImprovement } from "./techniques.js";
import { parseBankDetails } from "./checks.js";

function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const applyCallResult = internalMutation({
  // reviewed: the approver just judged an answer this call left for review, so its bill is waiting on
  // "Needs you", not "Calling".
  args: { call_id: v.string(), reviewed: v.optional(v.boolean()) },
  handler: async (ctx, { call_id, reviewed }) => {
    const request = await ctx.db
      .query("callRequests")
      .withIndex("by_key", (q) => q.eq("call_id", call_id))
      .unique();
    const result = await ctx.db
      .query("callResults")
      .withIndex("by_call", (q) => q.eq("call_id", call_id))
      .unique();
    if (!request || !result) return;

    // Incoming-line follow-ups and dev test calls have no bill behind them.
    const row = await ctx.db
      .query("bills")
      .withIndex("by_key", (q) => q.eq("key", request.bill_id))
      .unique();
    if (!row) return;

    // Only the bill's latest call speaks for it: a late result from an earlier call must not.
    const requests = await ctx.db
      .query("callRequests")
      .withIndex("by_bill", (q) => q.eq("bill_id", row.key))
      .collect();
    const latest = requests.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
    const now = new Date().toISOString();
    const log = (what: string, why: string) =>
      ctx.db.insert("activity", { key: `act_${crypto.randomUUID()}`, actor: "callback", what, why, refKind: "bill", refKey: row.key, at: now });

    // A person already moved the bill (held, paid, called again): record the call, decide nothing.
    if (latest.call_id !== call_id || (row.status !== "Calling" && !(reviewed && row.status === "Needs you"))) {
      const why =
        latest.call_id !== call_id
          ? "A newer check call on this bill decides it, so this one didn't change its status."
          : `The bill was already ${row.status}, so its status wasn't changed.`;
      await log(`finished a check call (${result.outcome.replace("_", " ")})`, `${sentence(result.summary)} ${why}`);
      return;
    }

    const bill = await hydrateBill(ctx, row);
    const decision = decideCallOutcome(bill, result.outcome, result.summary, await getCompany(ctx));
    await ctx.db.patch(row._id, { status: decision.status });
    if (decision.approval) {
      const pending = await ctx.db
        .query("approvals")
        .withIndex("by_bill", (q) => q.eq("billKey", row.key))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (pending) {
        await ctx.db.patch(pending._id, { ...decision.approval });
      } else {
        await ctx.db.insert("approvals", { key: `appr_${crypto.randomUUID()}`, billKey: row.key, status: "pending", thread: [], ...decision.approval });
      }
    }
    await log(decision.activity.what, decision.activity.why);

    // The real supplier didn't confirm it: a caught scam joins the cases every playbook change
    // is replayed against. Best effort, so a bill missing a record never undoes the hold above.
    if (result.outcome === "not_confirmed" && !row.practice) {
      try {
        await addBillToPracticeSet(ctx, row.key, "caught by check call");
      } catch (err) {
        console.warn(`couldn't keep ${row.key} as a test case`, err);
      }
    }

    // The real supplier confirmed a bill hold's playbook flagged: a false alarm to learn from.
    if (result.outcome === "confirmed" && bill.checks.some((c) => c.id === "fraud-technique" && c.state === "flag")) {
      await openImprovement(ctx, { kind: "false_alarm", billKey: row.key, text: bill.email.body, by: "callback" });
    }

    // A bank-change call just finished: propose a rule from what it found. Never on Practice or
    // a Practice-mode (simulated) call — only a real call to a real supplier teaches hold anything.
    const bankChange = bill.checks.some((c) => c.id === "bank-account" && c.state === "flag");
    if (bankChange && !row.practice && latest.mode !== "simulated") {
      const when = monthDay(now);
      if (result.outcome === "confirmed") {
        const details = parseBankDetails(bill.email.body);
        if (details) {
          await ctx.runMutation(internal.app.rules.proposeRule, {
            supplierKey: bill.supplier.key,
            text: `${bill.supplier.name} confirmed ${details.bank} \u00b7\u00b7${details.last4} on a call to the number on file, ${when}. Pay this account without calling again.`,
            kind: "verified_account",
            bankLast4: details.last4,
            bankName: details.bank,
            sourceKind: "call",
            sourceKey: call_id,
          });
        }
      } else if (result.outcome === "not_confirmed") {
        const contactFirst = bill.supplier.contactName?.split(" ")[0] || bill.supplier.name;
        await ctx.runMutation(internal.app.rules.proposeRule, {
          supplierKey: bill.supplier.key,
          text: `${contactFirst} said on the ${when} call that ${bill.supplier.name} never changed banks. Treat any email asking to pay a new account as a scam.`,
          kind: "never_changed_bank",
          sourceKind: "call",
          sourceKey: call_id,
        });
      }
    }
  },
});
