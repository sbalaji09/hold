import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

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
    for (const b of args.bills) await ctx.db.insert("bills", b);
    for (const e of args.emails) await ctx.db.insert("emails", e);
    for (const p of args.payments) {
      await ctx.db.insert("payments", p);
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
  },
});
