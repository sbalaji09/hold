import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { runChecks, routeEscalation, type CheckBankAccount } from "./app/checks";
import { TEN_THOUSAND_CENTS } from "../lib/policy";
import type { Check } from "../lib/types";

function fmtMoney(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Usage: `npm run seed` (reads data/fogline.json and runs this via
// `convex run seed:seed`). Internal-only: it clears every table and
// reloads it from the Fogline fixture, so never point it at a real
// deployment with live data.

const transcriptLine = v.object({
  speaker: v.union(v.literal("callback"), v.literal("supplier")),
  text: v.string(),
  ts: v.number(),
});

export const seed = internalMutation({
  args: {
    suppliers: v.array(
      v.object({
        key: v.string(),
        name: v.string(),
        category: v.union(
          v.literal("stage"),
          v.literal("sound"),
          v.literal("security"),
          v.literal("agency"),
          v.literal("food"),
          v.literal("other"),
        ),
        domain: v.string(),
        contactName: v.string(),
        contactEmail: v.string(),
        trustedPhone: v.string(),
        phoneLastCheckedAt: v.string(),
      }),
    ),
    bankAccounts: v.array(
      v.object({
        key: v.string(),
        supplierKey: v.string(),
        bank: v.string(),
        last4: v.string(),
        routingLast4: v.string(),
        routingNumber: v.optional(v.string()),
        accountNumber: v.optional(v.string()),
        status: v.union(v.literal("active"), v.literal("retired")),
        verifiedBy: v.union(v.literal("onboarding"), v.literal("call+dev")),
        addedAt: v.string(),
      }),
    ),
    bills: v.array(
      v.object({
        key: v.string(),
        supplierKey: v.string(),
        invoiceNo: v.string(),
        amountCents: v.number(),
        currency: v.literal("USD"),
        dueDate: v.string(),
        receivedAt: v.string(),
        bankAccountKey: v.string(),
        status: v.union(
          v.literal("Paid"),
          v.literal("Scheduled"),
          v.literal("Checking"),
          v.literal("Calling"),
          v.literal("Held"),
          v.literal("Needs you"),
        ),
        emailKey: v.string(),
        planted: v.boolean(),
      }),
    ),
    emails: v.array(
      v.object({
        key: v.string(),
        billKey: v.union(v.string(), v.null()),
        fromAddress: v.string(),
        fromDomain: v.string(),
        subject: v.string(),
        body: v.string(),
        receivedAt: v.string(),
        direction: v.union(v.literal("in"), v.literal("out")),
      }),
    ),
    payments: v.array(
      v.object({
        key: v.string(),
        billKey: v.string(),
        amountCents: v.number(),
        bankAccountKey: v.string(),
        // Historical fixture payments use "Paid"/"Scheduled" (data/fogline.json predates the
        // pending/sent/failed claim-flow states mutations.ts's claimPayment/recordPayment now
        // use); seeding below maps anything else to "sent" rather than widening the live schema.
        status: v.string(),
        transferId: v.optional(v.string()),
        paidAt: v.string(),
      }),
    ),
    calls: v.array(
      v.object({
        key: v.string(),
        supplierKey: v.string(),
        billKey: v.union(v.string(), v.null()),
        direction: v.union(v.literal("in"), v.literal("out")),
        startedAt: v.string(),
        summary: v.string(),
        transcript: v.array(transcriptLine),
        outcome: v.union(
          v.literal("confirmed"),
          v.literal("not_confirmed"),
          v.literal("handed_off"),
        ),
      }),
    ),
    plantedScams: v.array(
      v.object({
        key: v.string(),
        billKey: v.string(),
        kind: v.string(),
        description: v.string(),
        checksThatShouldFire: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const tables = [
      "suppliers",
      "bankAccounts",
      "bills",
      "emails",
      "payments",
      "callRequests",
      "callEvents",
      "callResults",
      "inboundCalls",
      "approvals",
      "activity",
      "practiceScams",
    ] as const;
    for (const table of tables) {
      const existing = await ctx.db.query(table).collect();
      for (const row of existing) await ctx.db.delete(row._id);
    }

    for (const s of args.suppliers) await ctx.db.insert("suppliers", s);
    for (const b of args.bankAccounts) await ctx.db.insert("bankAccounts", b);
    const billIdByKey = new Map<string, Id<"bills">>();
    for (const b of args.bills) billIdByKey.set(b.key, await ctx.db.insert("bills", b));
    for (const e of args.emails) await ctx.db.insert("emails", e);
    for (const p of args.payments) {
      const status = p.status === "pending" || p.status === "sent" || p.status === "failed" ? p.status : "sent";
      await ctx.db.insert("payments", { ...p, status });
      await ctx.db.insert("activity", {
        key: `act_pay_${p.key}`,
        actor: "callback",
        what: `Paid ${p.key}`,
        why: `Payment ${p.status.toLowerCase()} for bill ${p.billKey}`,
        refKind: "payment",
        refKey: p.key,
        at: p.paidAt,
      });
    }
    for (const c of args.plantedScams) await ctx.db.insert("practiceScams", c);

    // ponytail: fogline.json stores one flat historical "calls" record per
    // past call; the live schema splits that into callRequests/Events/
    // Results to match plan-agent.md's interface contract. Synthesize all
    // three from each historical call rather than adding a parallel
    // "calls" table. Revisit if historical calls need richer evidence/
    // reason data than the flat seed shape carries.
    const trustedPhoneBySupplier: Record<string, string> = {};
    for (const s of args.suppliers) trustedPhoneBySupplier[s.key] = s.trustedPhone;
    for (const c of args.calls) {
      await ctx.db.insert("callRequests", {
        call_id: c.key,
        bill_id: c.billKey ?? "",
        supplier_id: c.supplierKey,
        to_number: trustedPhoneBySupplier[c.supplierKey] ?? "",
        number_source: "on_file",
        reason: [],
        status: "done",
        startedAt: c.startedAt,
      });
      let ts = 0;
      for (const line of c.transcript) {
        await ctx.db.insert("callEvents", {
          call_id: c.key,
          type: "segment",
          speaker: line.speaker,
          text: line.text,
          ts: line.ts ?? ts++,
        });
      }
      await ctx.db.insert("callResults", {
        call_id: c.key,
        outcome: c.outcome,
        evidence: [],
        summary: c.summary,
        recording_url: "",
        startedAt: c.startedAt,
      });
    }

    // Derives each bill's `checks` (same pure rules lib/data.ts's buildChecks uses for the JSON
    // fallback) and opens a pending approval for every Held/Needs-you bill and every unpaid bill
    // over $10,000, matching what listApprovals shows in JSON mode.
    const suppliersByKey = new Map(args.suppliers.map((s) => [s.key, s]));
    const bankAccountsByKey = new Map(args.bankAccounts.map((b) => [b.key, b]));
    const emailsByKey = new Map(args.emails.map((e) => [e.key, e]));
    const callByBillKey = new Map<string, (typeof args.calls)[number]>();
    for (const c of args.calls) if (c.billKey) callByBillKey.set(c.billKey, c);

    const checksByBillKey = new Map<string, Check[]>();
    for (const b of args.bills) {
      const supplier = suppliersByKey.get(b.supplierKey);
      const bankAccount = bankAccountsByKey.get(b.bankAccountKey);
      const email = emailsByKey.get(b.emailKey);
      if (!supplier || !bankAccount || !email) continue;
      const call = callByBillKey.get(b.key) ?? null;
      const pastPaid = args.bills.filter((x) => x.supplierKey === b.supplierKey && x.key !== b.key && x.status === "Paid");
      const pastPaidBankAccounts: CheckBankAccount[] = pastPaid.map((x) => {
        const a = bankAccountsByKey.get(x.bankAccountKey);
        return { bank: a?.bank ?? "unknown", last4: a?.last4 ?? "0000" };
      });
      const checks = runChecks({
        email: { body: email.body, fromAddress: email.fromAddress, fromDomain: email.fromDomain },
        supplier: { key: supplier.key, name: supplier.name, domain: supplier.domain },
        currentBankAccount: {
          bank: bankAccount.bank,
          last4: bankAccount.last4,
          verifiedBy: bankAccount.verifiedBy,
          confirmedByCall: bankAccount.verifiedBy === "call+dev" && call?.outcome === "confirmed",
        },
        pastPaidBankAccounts,
        pastPaidAmounts: pastPaid.map((x) => x.amountCents),
        amountCents: b.amountCents,
      });
      checksByBillKey.set(b.key, checks);
      const id = billIdByKey.get(b.key);
      if (id) await ctx.db.patch(id, { checks });
    }

    for (const b of args.bills) {
      const approvable = b.status === "Held" || b.status === "Needs you" || (b.amountCents > TEN_THOUSAND_CENTS && b.status !== "Paid");
      if (!approvable) continue;
      const checks = checksByBillKey.get(b.key) ?? [];
      const call = callByBillKey.get(b.key) ?? null;
      const flagged = checks.filter((c) => c.state === "flag");
      const bankAccount = bankAccountsByKey.get(b.bankAccountKey);
      const recommendation =
        flagged.length > 0
          ? `Hold this payment. ${flagged.map((c) => c.evidence).join(" ")}`
          : `Pay ${fmtMoney(b.amountCents)} to ${bankAccount?.bank ?? "the account on file"} \u00b7\u00b7${bankAccount?.last4 ?? ""}. All checks passed; this is over Callback's $10,000 limit, so Dev needs to approve it.`;
      const kind = checks.find((c) => c.id === "bank-account" && c.state === "flag")
        ? "bank_change"
        : b.status === "Held"
          ? "held_payment"
          : "big_payment";
      const route = routeEscalation(checks, b.amountCents, { callOutcome: call?.outcome === "handed_off" ? "handed_off" : null });
      await ctx.db.insert("approvals", {
        key: `appr_${b.key}`,
        billKey: b.key,
        kind,
        status: "pending",
        recommendation,
        routedTo: route.routedTo,
        reason: route.reason,
        thread: [],
      });
    }
  },
});
