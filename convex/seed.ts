import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, type ObjectType } from "convex/values";
import { runChecks, routeEscalation, type CheckBankAccount } from "./app/checks";
import { insertSeedPlaybook } from "./app/techniques";
import { companyFor, wholeDollars } from "../lib/company";
import type { Check } from "../lib/types";

function fmtMoney(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Usage: `pnpm seed` (data/fogline.json), `pnpm seed:bayline` or `pnpm seed:harbor` runs this via
// `convex run seed:seed`; the app's template switch (convex/app/workspace.ts) runs it too.
// Internal-only: it clears the workspace's tables and reloads them from a fixture, so never point it
// at a real deployment with live data. `company` names whose data this is (lib/company.ts); absent =
// Fogline. `keepPlaybooks` leaves the learned playbooks alone, so what hold learned at one company
// carries over to the next.

const transcriptLine = v.object({
  speaker: v.union(v.literal("callback"), v.literal("supplier")),
  text: v.string(),
  ts: v.number(),
});

export const seedArgs = {
    company: v.optional(v.string()),
    keepPlaybooks: v.optional(v.boolean()),
    // The payee whose check call the demo rings on a real phone: DEMO_PAYEE_PHONE (Convex env).
    hero: v.optional(v.string()),
    suppliers: v.array(
      v.object({
        key: v.string(),
        name: v.string(),
        category: v.string(),
        domain: v.string(),
        contactName: v.string(),
        contactEmail: v.string(),
        trustedPhone: v.string(),
        phoneLastCheckedAt: v.string(),
        language: v.optional(v.string()),
        phoneMenu: v.optional(v.string()),
        timeZone: v.optional(v.string()),
        // The company's own file on the payee (an employee's HR record, a seller's escrow file).
        // Same shape as suppliers.onboarding; the schema checks it on insert.
        onboarding: v.optional(v.any()),
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
};

export type SeedArgs = ObjectType<typeof seedArgs>;

export const seed = internalMutation({ args: seedArgs, handler: (ctx, args) => runSeed(ctx, args) });

/** Clears the workspace and loads one company's fixture. Also run by the template switch. */
export async function runSeed(ctx: MutationCtx, args: SeedArgs): Promise<void> {
  const co = companyFor(args.company);
  const playbookTables = ["fraudTechniques", "improvements"] as const;
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
    "learnedRules",
    "backgroundChecks",
    ...(args.keepPlaybooks ? [] : playbookTables),
  ] as const;
  for (const table of tables) {
    const existing = await ctx.db.query(table).collect();
    for (const row of existing) await ctx.db.delete(row._id);
  }

  // A real phone a teammate holds stands in for every supplier's number on file, so any call rings it (setup, not a call).
  const demoPhone = process.env.DEMO_PAYEE_PHONE;
  for (const s of args.suppliers) {
    await ctx.db.insert("suppliers", demoPhone ? { ...s, trustedPhone: demoPhone } : s);
  }
  for (const b of args.bankAccounts) await ctx.db.insert("bankAccounts", b);
  // Only settled history is loaded. Unpaid bills from the fixture would show checks and approvals
  // nothing ran, so they're dropped; the planted scams stay as Practice fixtures, hidden from the inbox.
  const bills = args.bills.filter((b) => b.status === "Paid" || b.planted);
  const kept = new Set(bills.map((b) => b.key));
  const billIdByKey = new Map<string, Id<"bills">>();
  for (const b of bills) billIdByKey.set(b.key, await ctx.db.insert("bills", b.planted ? { ...b, practice: true } : b));
  for (const e of args.emails) if (!e.billKey || kept.has(e.billKey)) await ctx.db.insert("emails", e);
  // History isn't hold's own work, so it adds nothing to the activity log; that starts empty and fills as hold acts.
  for (const p of args.payments.filter((p) => kept.has(p.billKey))) {
    const status = p.status === "pending" || p.status === "sent" || p.status === "failed" ? p.status : "sent";
    await ctx.db.insert("payments", { ...p, status });
  }
  for (const c of args.plantedScams) await ctx.db.insert("practiceScams", c);
  await insertSeedPlaybook(ctx);
  const settings = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "global")).unique();
  if (settings) await ctx.db.patch(settings._id, { company: co.key });
  else await ctx.db.insert("settings", { key: "global", watchOnly: false, company: co.key });

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
  for (const b of bills) {
    const supplier = suppliersByKey.get(b.supplierKey);
    const bankAccount = bankAccountsByKey.get(b.bankAccountKey);
    const email = emailsByKey.get(b.emailKey);
    if (!supplier || !bankAccount || !email) continue;
    const call = callByBillKey.get(b.key) ?? null;
    const pastPaid = bills.filter((x) => x.supplierKey === b.supplierKey && x.key !== b.key && x.status === "Paid");
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
      company: co,
    });
    checksByBillKey.set(b.key, checks);
    const id = billIdByKey.get(b.key);
    if (id) await ctx.db.patch(id, { checks });
  }

  for (const b of bills) {
    if (b.planted) continue;
    const approvable = b.status === "Held" || b.status === "Needs you" || (b.amountCents >= co.approvalLimitCents && b.status !== "Paid");
    if (!approvable) continue;
    const checks = checksByBillKey.get(b.key) ?? [];
    const call = callByBillKey.get(b.key) ?? null;
    const flagged = checks.filter((c) => c.state === "flag");
    const bankAccount = bankAccountsByKey.get(b.bankAccountKey);
    const recommendation =
      flagged.length > 0
        ? `Hold this payment. ${flagged.map((c) => c.evidence).join(" ")}`
        : `Pay ${fmtMoney(b.amountCents)} to ${bankAccount?.bank ?? "the account on file"} \u00b7\u00b7${bankAccount?.last4 ?? ""}. All checks passed; this is over hold's ${wholeDollars(co.approvalLimitCents)} limit, so ${co.dev.name} needs to approve it.`;
    const kind = checks.find((c) => c.id === "bank-account" && c.state === "flag")
      ? "bank_change"
      : b.status === "Held"
        ? "held_payment"
        : "big_payment";
    const route = routeEscalation(checks, b.amountCents, { callOutcome: call?.outcome ?? null, company: co });
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
}
