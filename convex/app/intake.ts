// Real bills inbox intake (plan-agent.md step 2-4). http.ts's webhook and Practice's "Try a
// scam" both land here: parse the raw email, find the supplier, run checks.ts's rules, and
// route the bill by decide()'s pay / ask_dev / call.
//
// Split gather -> styleMatch -> finalize because actions can't touch ctx.db directly and
// mutations can't call voice's styleMatch action.
import { v } from "convex/values";
import { api, internal } from "../_generated/api.js";
import type { Doc } from "../_generated/dataModel.js";
import { action, internalMutation, internalQuery, type QueryCtx } from "../_generated/server.js";
import { checkValidator, decide, runChecks, type CheckBankAccount, type Decision } from "./checks.js";

// ---------- parsing (pure, unit-tested in intake.test.ts) ----------

const EMAIL_RE = /<?([\w.+-]+@([\w-]+(?:\.[\w-]+)+))>?/;
const AMOUNT_RE = /\$\s?([\d,]+(?:\.\d{2})?)/g;
const INVOICE_RE = /invoice\s*#?\s*(\d{3,8})|#(\d{3,8})/i;
const BANK_DETAIL_RE = /([A-Z][A-Za-z& ]{2,30}?),?\s+account\s+(?:ending|number ending|#)\s*(\d{3,6})/;

/** "Rosa Quintero <rosa@stagecraftrigging.com>" or a bare address -> the sender's domain, lowercased. */
export function parseSenderDomain(from: string): string {
  return (EMAIL_RE.exec(from)?.[2] ?? "").toLowerCase();
}

/** The bare address, for the email row's fromAddress. */
export function parseSenderAddress(from: string): string {
  return EMAIL_RE.exec(from)?.[1] ?? from.trim();
}

/** The largest dollar amount mentioned in the body, in cents. Null if the body names none. */
export function parseAmountCents(body: string): number | null {
  const amounts = [...body.matchAll(AMOUNT_RE)].map((m) => Math.round(parseFloat(m[1]!.replace(/,/g, "")) * 100));
  return amounts.length ? Math.max(...amounts) : null;
}

export function parseInvoiceNo(body: string): string | null {
  const match = INVOICE_RE.exec(body);
  return match?.[1] ?? match?.[2] ?? null;
}

/** Bank name + last4 the email asks to pay, for evidence and the activity log only. Never stored
 * as the bill's bankAccountKey, which always stays the supplier's account on file. */
export function parseBankDetails(body: string): { bank: string; last4: string } | null {
  const match = BANK_DETAIL_RE.exec(body);
  return match ? { bank: match[1]!.trim(), last4: match[2]! } : null;
}

function freshKey(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function fmtMoney(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function findSupplierByEmail(ctx: QueryCtx, fromDomain: string, subject: string, body: string): Promise<Doc<"suppliers"> | null> {
  const suppliers = await ctx.db.query("suppliers").collect();
  const byDomain = suppliers.find((s) => s.domain.toLowerCase() === fromDomain);
  if (byDomain) return byDomain;
  const text = `${subject} ${body}`.toLowerCase();
  return suppliers.find((s) => text.includes(s.name.toLowerCase())) ?? null;
}

// ---------- gather (read-only) ----------

interface IntakeContext {
  supplier: Doc<"suppliers">;
  currentBankAccount: { bank: string; last4: string; verifiedBy: "onboarding" | "call+dev"; confirmedByCall?: boolean };
  currentBankAccountKey: string;
  pastPaidBankAccounts: CheckBankAccount[];
  pastPaidAmounts: number[];
}

export const gatherIntakeContext = internalQuery({
  args: { fromDomain: v.string(), subject: v.string(), body: v.string() },
  handler: async (ctx, { fromDomain, subject, body }): Promise<IntakeContext | null> => {
    const supplier = await findSupplierByEmail(ctx, fromDomain, subject, body);
    if (!supplier) return null;

    const accounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier.key))
      .collect();
    const active = accounts.find((a) => a.status === "active") ?? accounts[0];
    if (!active) throw new Error(`Supplier ${supplier.key} has no bank account on file`);
    const accountsByKey = new Map(accounts.map((a) => [a.key, a]));

    const paidBills = await ctx.db
      .query("bills")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier.key))
      .filter((q) => q.eq(q.field("status"), "Paid"))
      .collect();

    return {
      supplier,
      currentBankAccount: {
        bank: active.bank,
        last4: active.last4,
        verifiedBy: active.verifiedBy,
        // A static "call+dev" row only exists once Dev approved it after a confirmed call
        // (see convex/voice/server.ts's finishInboundCall / the bank-change approval flow), so
        // the verification itself is the confirmation — no separate live flag to track here.
        confirmedByCall: active.verifiedBy === "call+dev",
      },
      currentBankAccountKey: active.key,
      pastPaidBankAccounts: paidBills.map((b) => {
        const account = accountsByKey.get(b.bankAccountKey);
        return { bank: account?.bank ?? "unknown", last4: account?.last4 ?? "0000" };
      }),
      pastPaidAmounts: paidBills.map((b) => b.amountCents),
    };
  },
});

// ---------- finalize (write) ----------

const activity = (actor: "callback", what: string, why: string, refKind: string, refKey: string) => ({
  key: freshKey("act"),
  actor,
  what,
  why,
  refKind,
  refKey,
  at: new Date().toISOString(),
});

export const recordUnknownSender = internalMutation({
  args: { from: v.string(), fromDomain: v.string(), subject: v.string(), body: v.string(), receivedAt: v.string() },
  handler: async (ctx, args): Promise<{ billKey: string; supplierKey: string; status: "Needs you" }> => {
    const billKey = freshKey("bill_in");
    const emailKey = freshKey("email_in");
    // ponytail: no real supplier row to point at, so the bill carries a sentinel supplierKey
    // instead of a schema change. The Inbox/bill page show it as unmatched; Maya re-files it by
    // hand. Upgrade to a real "unmatched sender" queue if this gets common.
    const supplierKey = `unknown:${args.fromDomain || "no-domain"}`;
    await ctx.db.insert("emails", {
      key: emailKey,
      billKey,
      fromAddress: parseSenderAddress(args.from),
      fromDomain: args.fromDomain,
      subject: args.subject,
      body: args.body,
      receivedAt: args.receivedAt,
      direction: "in",
    });
    await ctx.db.insert("bills", {
      key: billKey,
      supplierKey,
      invoiceNo: parseInvoiceNo(args.body) ?? "unknown",
      amountCents: parseAmountCents(args.body) ?? 0,
      currency: "USD",
      dueDate: args.receivedAt,
      receivedAt: args.receivedAt,
      bankAccountKey: "",
      status: "Needs you",
      emailKey,
      planted: false,
      checks: [],
    });
    await ctx.db.insert("activity", activity(
      "callback",
      "Flagged an email from an unrecognized sender",
      `No supplier record matches ${args.fromDomain || "this sender"}. Maya needs to review it by hand.`,
      "bill",
      billKey,
    ));
    return { billKey, supplierKey, status: "Needs you" };
  },
});

export const finalizeIntake = internalMutation({
  args: {
    from: v.string(),
    fromDomain: v.string(),
    subject: v.string(),
    body: v.string(),
    receivedAt: v.string(),
    supplier: v.object({ key: v.string(), name: v.string(), trustedPhone: v.string() }),
    bankAccountKey: v.string(),
    amountCents: v.number(),
    invoiceNo: v.string(),
    checks: v.array(checkValidator),
    decision: v.union(v.literal("pay"), v.literal("ask_dev"), v.literal("call")),
  },
  handler: async (ctx, args): Promise<{ billKey: string; supplierKey: string; status: Doc<"bills">["status"] }> => {
    const billKey = freshKey("bill_in");
    const emailKey = freshKey("email_in");
    const status: Doc<"bills">["status"] = args.decision === "pay" ? "Scheduled" : args.decision === "ask_dev" ? "Needs you" : "Calling";

    await ctx.db.insert("emails", {
      key: emailKey,
      billKey,
      fromAddress: parseSenderAddress(args.from),
      fromDomain: args.fromDomain,
      subject: args.subject,
      body: args.body,
      receivedAt: args.receivedAt,
      direction: "in",
    });
    await ctx.db.insert("bills", {
      key: billKey,
      supplierKey: args.supplier.key,
      invoiceNo: args.invoiceNo,
      amountCents: args.amountCents,
      currency: "USD",
      dueDate: args.receivedAt,
      receivedAt: args.receivedAt,
      bankAccountKey: args.bankAccountKey,
      status,
      emailKey,
      planted: false,
      checks: args.checks,
    });

    const flaggedLabels = args.checks.filter((c) => c.state === "flag").map((c) => c.label);
    const money = fmtMoney(args.amountCents);

    if (args.decision === "pay") {
      await ctx.db.insert("activity", activity(
        "callback",
        `Scheduled ${money} for ${args.supplier.name} (invoice #${args.invoiceNo})`,
        "Every check passed and it's under the $10,000 limit.",
        "bill",
        billKey,
      ));
    } else if (args.decision === "ask_dev") {
      await ctx.db.insert("approvals", {
        key: freshKey("appr"),
        billKey,
        kind: "big_payment",
        status: "pending",
        recommendation: `Every check passed. This is ${money}, over Callback's $10,000 limit, so it needs Dev's approval.`,
        thread: [],
      });
      await ctx.db.insert("activity", activity(
        "callback",
        `Asked Dev to approve ${money} for ${args.supplier.name} (invoice #${args.invoiceNo})`,
        "Safe, but over the $10,000 limit Callback can approve on its own.",
        "bill",
        billKey,
      ));
    } else {
      // call: contract shape (plan-agent.md "Interface contract" §1) — to_number only ever the
      // supplier's trusted number on file, never anything from the email.
      await ctx.db.insert("callRequests", {
        call_id: freshKey("call"),
        bill_id: billKey,
        supplier_id: args.supplier.key,
        to_number: args.supplier.trustedPhone,
        number_source: "on_file",
        reason: flaggedLabels,
        status: "queued",
        mode: "live",
        attempt: 0,
      });
      await ctx.db.insert("activity", activity(
        "callback",
        `Calling ${args.supplier.name} on the number on file to verify invoice #${args.invoiceNo}`,
        flaggedLabels.length ? flaggedLabels.join(", ") : "This bill needs a check call.",
        "bill",
        billKey,
      ));
    }

    return { billKey, supplierKey: args.supplier.key, status };
  },
});

// ---------- entry point ----------

export const ingestEmail = action({
  args: { from: v.string(), subject: v.string(), body: v.string(), receivedAt: v.string() },
  handler: async (ctx, args): Promise<{ billKey: string; supplierKey: string; status: string }> => {
    const fromDomain = parseSenderDomain(args.from);
    const context: IntakeContext | null = await ctx.runQuery(internal.app.intake.gatherIntakeContext, {
      fromDomain,
      subject: args.subject,
      body: args.body,
    });

    if (!context) {
      return await ctx.runMutation(internal.app.intake.recordUnknownSender, {
        from: args.from,
        fromDomain,
        subject: args.subject,
        body: args.body,
        receivedAt: args.receivedAt,
      });
    }

    let styleMatch: { matches: boolean; reasons: string[] } | undefined;
    try {
      const result = await ctx.runAction(api.voice.styleMatch.styleMatch, {
        supplier_id: context.supplier.key,
        email_text: args.body,
      });
      styleMatch = { matches: result.matches, reasons: result.reasons };
    } catch (err) {
      // ponytail: styleMatch needs ANTHROPIC_API_KEY (and optionally Moss) configured; if it's
      // missing or the call fails, skip that one check rather than blocking intake on it — the
      // other four checks still run and still decide. Upgrade to a retry/alert if this fires in prod.
      console.warn(`styleMatch failed for ${context.supplier.key}:`, err);
    }

    const amountCents = parseAmountCents(args.body) ?? 0;
    const invoiceNo = parseInvoiceNo(args.body) ?? "unknown";
    const fromAddress = parseSenderAddress(args.from);

    const checks = runChecks({
      email: { body: args.body, fromAddress, fromDomain },
      supplier: { key: context.supplier.key, name: context.supplier.name, domain: context.supplier.domain },
      currentBankAccount: context.currentBankAccount,
      pastPaidBankAccounts: context.pastPaidBankAccounts,
      pastPaidAmounts: context.pastPaidAmounts,
      amountCents,
      styleMatch,
    });
    const decision: Decision = decide(checks, amountCents);

    return await ctx.runMutation(internal.app.intake.finalizeIntake, {
      from: args.from,
      fromDomain,
      subject: args.subject,
      body: args.body,
      receivedAt: args.receivedAt,
      supplier: { key: context.supplier.key, name: context.supplier.name, trustedPhone: context.supplier.trustedPhone },
      bankAccountKey: context.currentBankAccountKey,
      amountCents,
      invoiceNo,
      checks,
      decision,
    });
  },
});
