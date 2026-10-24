// Practice screen: fake scam emails written by Claude, run against a
// read-only copy of the workspace (no writes to bills/payments/call
// requests — Practice never moves money or dials a phone), and whether
// each was caught last time it ran. See product-brief.md "Practice" and
// plan-agent.md "Together with the voice person".
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { v } from "convex/values";
import { z } from "zod";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server.js";
// convex/app/checks.ts is owned by another agent; its signature per the
// contract we agreed on is:
//   runChecks({ email, supplier, currentBankAccount, pastPaidBankAccounts,
//               pastPaidAmounts, amountCents, styleMatch? }) -> Check[]
//   decide(checks, amountCents) -> "pay" | "ask_dev" | "call"
import { decide, runChecks } from "./checks.js";

const MODEL = "claude-sonnet-5-5";

// Exported as a test seam: both `addToPracticeSet` and `insertGenerated`
// dedupe scams by this truncated description, so the truncation rule lives
// in one place.
export function descriptionFromBody(body: string): string {
  return body.slice(0, 160);
}

// ---------- shared row assembly (list, gatherForRun, addToPracticeSet) ----------

/** Everything runChecks/decide need for one bill, read straight from the live
 * tables (never a separate "practice copy" table — a plain read is already a
 * copy: this never writes bills/payments/callRequests). Shared by the list
 * screen (to show which check fires right now), the full-set run, and
 * "Add to practice set" (to snapshot which checks should fire). */
async function gatherRow(
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

// ---------- add to practice set (any bill, e.g. one Callback missed) ----------

export const addToPracticeSet = mutation({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => {
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
      kind: "from bill",
      description: descriptionFromBody(row.email.body),
      checksThatShouldFire: firedChecks(row),
    });
    return { key: scamKey };
  },
});

// ---------- run set ----------

/** Everything runChecks/decide need for one scam, read straight from the
 * live tables (never a separate "practice copy" table — a plain read is
 * already a copy: this never writes bills/payments/callRequests). */
export interface PracticeRunRow {
  scamKey: string;
  email: { fromAddress: string; fromDomain: string; body: string };
  supplier: { key: string; name: string; domain: string };
  currentBankAccount: { bank: string; last4: string; verifiedBy: "onboarding" | "call+dev"; confirmedByCall: boolean };
  pastPaidBankAccounts: Array<{ bank: string; last4: string }>;
  pastPaidAmounts: number[];
  amountCents: number;
}

export const gatherForRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const scams = await ctx.db.query("practiceScams").collect();
    const out: PracticeRunRow[] = [];
    for (const scam of scams) {
      const row = await gatherRow(ctx, scam.billKey);
      if (!row) continue;
      out.push({ scamKey: scam.key, ...row });
    }
    return out;
  },
});

export const recordRun = mutation({
  args: {
    results: v.array(v.object({ key: v.string(), caught: v.boolean() })),
  },
  handler: async (ctx, { results }) => {
    const now = new Date().toISOString();
    for (const r of results) {
      const row = await ctx.db
        .query("practiceScams")
        .withIndex("by_key", (q) => q.eq("key", r.key))
        .unique();
      if (!row) continue;
      await ctx.db.patch(row._id, { caughtLastRun: r.caught, lastRunAt: now });
    }
  },
});

const gatherForRunRef = makeFunctionReference<"query", Record<string, never>, PracticeRunRow[]>("app/practice:gatherForRun");
const recordRunRef = makeFunctionReference<"mutation", { results: Array<{ key: string; caught: boolean }> }, null>("app/practice:recordRun");

/** Runs every planted + judge-written scam through the real decision
 * logic, against a read-only snapshot. "Caught" = Callback doesn't just
 * pay it outright. Records caught/missed, writes nothing else. */
export const runSet = action({
  args: {},
  handler: async (ctx): Promise<{ ran: number; caught: number; missed: number }> => {
    const rows = await ctx.runQuery(gatherForRunRef, {});
    const results = rows.map((row) => {
      const checks = runChecks({
        email: row.email,
        supplier: row.supplier,
        currentBankAccount: row.currentBankAccount,
        pastPaidBankAccounts: row.pastPaidBankAccounts,
        pastPaidAmounts: row.pastPaidAmounts,
        amountCents: row.amountCents,
      });
      const decision = decide(checks, row.amountCents);
      return { key: row.scamKey, caught: decision !== "pay" };
    });
    await ctx.runMutation(recordRunRef, { results });
    const caught = results.filter((r) => r.caught).length;
    return { ran: results.length, caught, missed: results.length - caught };
  },
});

// ---------- generate set (Claude writes new planted scams) ----------

const GeneratedScam = z.object({
  kind: z.string(),
  from: z.string(),
  fromDomain: z.string(),
  subject: z.string(),
  body: z.string(),
  supplierKey: z.string(),
  amountCents: z.number().int().positive(),
  checksThatShouldFire: z.array(z.string()),
});
const GeneratedSet = z.object({ scams: z.array(GeneratedScam) });
type GeneratedScam = z.infer<typeof GeneratedScam>;
const generatedScamValidator = v.object({
  kind: v.string(),
  from: v.string(),
  fromDomain: v.string(),
  subject: v.string(),
  body: v.string(),
  supplierKey: v.string(),
  amountCents: v.number(),
  checksThatShouldFire: v.array(v.string()),
});

const SYSTEM = `You write realistic payment-scam emails for Fogline, a made-up music festival, to test a bill-checking agent called Callback. Each scam impersonates a real Fogline supplier and should trip one or more of these checks: a bank account Fogline hasn't paid before, a look-alike sender domain, rush/urgent language, or an unusual amount vs the supplier's history. Write the way a real scammer or a hacked supplier account would: plausible invoice references, normal business tone with the scam signal woven in, not cartoonish. Vary the kind across the set, favoring pretexts the current set doesn't already have: generic urgency, a CEO-impersonation request ("I need this paid right now, I'm in a meeting"), a partial bank change where only the routing number changes and the account number stays the same, reuse of a real past invoice number to look legitimate, and a forwarded-thread hijack (a reply to an old real thread with the payment details swapped). Never repeat a description already in the set below — write a genuinely new pretext for each.`;

function buildPrompt(
  suppliers: Array<{ key: string; name: string; domain: string }>,
  existingDescriptions: string[],
): string {
  const list = suppliers.map((s) => `- ${s.key}: ${s.name} (${s.domain})`).join("\n");
  const avoid =
    existingDescriptions.length > 0
      ? `\n\nScams already in the practice set — do not repeat these pretexts or wording:\n${existingDescriptions.map((d) => `- ${d}`).join("\n")}`
      : "";
  return `Fogline's suppliers:\n${list}\n\nWrite 8 scam emails, each impersonating one of the suppliers above by key. For each: kind (short label), from (a plausible sender address — the supplier's real domain for a hacked-account scam, or a look-alike domain for a spoofed one), fromDomain, subject, body (a few sentences, an invoice-style email), supplierKey (must be one of the keys above), amountCents (a plausible invoice amount in cents), and checksThatShouldFire (which of: "new bank account", "look-alike domain", "rush language", "unusual amount" this email should trip).${avoid}`;
}

export const listSuppliersForPrompt = internalQuery({
  args: {},
  handler: async (ctx) => {
    const suppliers = await ctx.db.query("suppliers").collect();
    const scams = await ctx.db.query("practiceScams").collect();
    return {
      suppliers: suppliers.map((s) => ({ key: s.key, name: s.name, domain: s.domain })),
      existingDescriptions: scams.map((s) => s.description),
    };
  },
});

export const insertGenerated = internalMutation({
  args: { scams: v.array(generatedScamValidator) },
  handler: async (ctx, { scams }) => {
    const now = Date.now();
    let inserted = 0;
    const existing = await ctx.db.query("practiceScams").collect();
    const seenDescriptions = new Set(existing.map((e) => e.description));
    for (const [i, s] of scams.entries()) {
      const description = descriptionFromBody(s.body);
      if (seenDescriptions.has(description)) continue; // dedup by description — Claude repeated an existing pretext.
      const supplier = await ctx.db
        .query("suppliers")
        .withIndex("by_key", (q) => q.eq("key", s.supplierKey))
        .unique();
      if (!supplier) continue; // Claude named a supplier that doesn't exist; skip rather than fake one.
      const bankAccount = await ctx.db
        .query("bankAccounts")
        .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier.key))
        .filter((q) => q.eq(q.field("status"), "active"))
        .first();
      if (!bankAccount) continue;
      const stamp = now + i;
      const emailKey = `email_practice_${stamp}`;
      const billKey = `bill_practice_${stamp}`;
      const scamKey = `scam_practice_${stamp}`;
      const receivedAt = new Date(stamp).toISOString();
      await ctx.db.insert("emails", {
        key: emailKey,
        billKey,
        fromAddress: s.from,
        fromDomain: s.fromDomain,
        subject: s.subject,
        body: s.body,
        receivedAt,
        direction: "in",
      });
      await ctx.db.insert("bills", {
        key: billKey,
        supplierKey: supplier.key,
        invoiceNo: `PRACTICE-${stamp}`,
        amountCents: s.amountCents,
        currency: "USD",
        dueDate: receivedAt,
        receivedAt,
        bankAccountKey: bankAccount.key,
        status: "Checking",
        emailKey,
        planted: true,
      });
      await ctx.db.insert("practiceScams", {
        key: scamKey,
        billKey,
        kind: s.kind,
        description,
        checksThatShouldFire: s.checksThatShouldFire,
      });
      seenDescriptions.add(description);
      inserted++;
    }
    return inserted;
  },
});

const listSuppliersForPromptRef = makeFunctionReference<
  "query",
  Record<string, never>,
  { suppliers: Array<{ key: string; name: string; domain: string }>; existingDescriptions: string[] }
>("app/practice:listSuppliersForPrompt");
const insertGeneratedRef = makeFunctionReference<"mutation">("app/practice:insertGenerated");

export const generateSet = action({
  args: {},
  handler: async (ctx): Promise<{ inserted: number }> => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("generateSet needs ANTHROPIC_API_KEY set in the Convex deployment's environment.");
    }
    const { suppliers, existingDescriptions } = await ctx.runQuery(listSuppliersForPromptRef, {});
    if (suppliers.length === 0) {
      throw new Error("generateSet: no suppliers to impersonate. Seed the workspace first.");
    }
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium", format: zodOutputFormat(GeneratedSet) },
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(suppliers, existingDescriptions) }],
    });
    const parsed = response.parsed_output;
    if (response.stop_reason === "refusal" || !parsed) {
      throw new Error(`generateSet: no scams from Claude (stop_reason ${response.stop_reason})`);
    }
    const inserted = await ctx.runMutation(insertGeneratedRef, { scams: parsed.scams });
    return { inserted };
  },
});
