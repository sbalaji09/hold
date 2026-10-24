// Real bills inbox intake (plan-agent.md step 2-4). http.ts's webhook and Practice's "Try a
// scam" both land here: parse the raw email, find the supplier, run checks.ts's rules, and
// route the bill by decide()'s pay / ask_dev / call.
//
// Split gather -> styleMatch -> finalize because actions can't touch ctx.db directly and
// mutations can't call voice's styleMatch action.
import { v } from "convex/values";
import { api, internal } from "../_generated/api.js";
import type { Doc } from "../_generated/dataModel.js";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "../_generated/server.js";
import { checkValidator, decide, routeEscalation, runChecks, type CheckBankAccount, type Decision, type LearnedRuleInput } from "./checks.js";
import { forChannel, techniqueCheck } from "../../lib/fraudTechniques.js";
import { anthropic, assessEmail } from "./techniques.js";
import { judgeEmail, toKinds } from "./triage.js";
import { lookalikeOf, readNewcomer } from "./onboarding.js";
import type { Check } from "../../lib/types.js";
import { routeEmail } from "../../lib/triage.js";
import { getCompany } from "./company.js";
import { wholeDollars } from "../../lib/company.js";

// ---------- parsing (pure, unit-tested in intake.test.ts) ----------

const EMAIL_RE = /<?([\w.+-]+@([\w-]+(?:\.[\w-]+)+))>?/;
const AMOUNT_RE = /\$\s?([\d,]+(?:\.\d{2})?)/g;
// "invoice #4471", "Invoice PK-2207", "Invoice No. 2026-031", "#L-104". The number must hold a digit,
// so "invoice for" or "invoice attached" never reads as one. A leading "INV-" is dropped because the
// app already shows invoices as INV-<number>.
const INVOICE_TOKEN = String.raw`(?:inv-?)?((?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)*)`;
const INVOICE_RE = new RegExp(String.raw`invoice\s*(?:no\.?|number)?\s*#?\s*${INVOICE_TOKEN}|#\s*${INVOICE_TOKEN}`, "i");
const BANK_DETAIL_RE = /([A-Z][A-Za-z& ]{2,30}?),?\s+account\s+(?:ending|number ending|#)\s*(\d{3,6})/;
// plan-agent.md addendum §3: a bank change or a $5,000+ bill from a `new` supplier always calls.
const NEW_SUPPLIER_CALL_THRESHOLD_CENTS = 500_000;

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
  return (match?.[1] ?? match?.[2])?.toUpperCase() ?? null;
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

/**
 * Which payee an email is from: the exact address on file, else the one payee that owns the
 * domain, else a payee the email names. Employees share the company's domain and home sellers
 * share gmail.com, so a shared domain alone never decides it.
 */
async function findSupplierByEmail(
  ctx: QueryCtx,
  fromDomain: string,
  subject: string,
  body: string,
  fromAddress?: string,
): Promise<Doc<"suppliers"> | null> {
  const suppliers = await ctx.db.query("suppliers").collect();
  const address = fromAddress?.toLowerCase();
  const byAddress = address ? suppliers.find((s) => s.contactEmail.toLowerCase() === address) : undefined;
  if (byAddress) return byAddress;
  const sameDomain = suppliers.filter((s) => s.domain.toLowerCase() === fromDomain);
  if (sameDomain.length === 1) return sameDomain[0]!;
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
  learnedRules: LearnedRuleInput[];
}

export const gatherIntakeContext = internalQuery({
  args: { fromDomain: v.string(), subject: v.string(), body: v.string(), fromAddress: v.optional(v.string()) },
  handler: async (ctx, { fromDomain, subject, body, fromAddress }): Promise<IntakeContext | null> => {
    const supplier = await findSupplierByEmail(ctx, fromDomain, subject, body, fromAddress);
    if (!supplier) return null;

    const accounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier.key))
      .collect();
    const active = accounts.find((a) => a.status === "active") ?? accounts[0];
    // A New supplier with no verified account yet: its bills go through onboarding (attached to the
    // existing draft), never the normal pay path.
    if (!active && supplier.status === "new") return null;
    if (!active) throw new Error(`Supplier ${supplier.key} has no bank account on file`);
    const accountsByKey = new Map(accounts.map((a) => [a.key, a]));

    const paidBills = await ctx.db
      .query("bills")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier.key))
      .filter((q) => q.eq(q.field("status"), "Paid"))
      .collect();

    const ruleRows = await ctx.db
      .query("learnedRules")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier.key))
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
      learnedRules: ruleRows.map((r) => ({ text: r.text, sourceKind: r.sourceKind, sourceKey: r.sourceKey })),
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

export const findDuplicateEmail = internalQuery({
  args: { messageId: v.optional(v.string()), fromAddress: v.string(), subject: v.string(), body: v.string() },
  handler: async (ctx, args): Promise<{ billKey: string; supplierKey: string; status: string } | null> => {
    let existing: Doc<"emails"> | null = null;
    if (args.messageId) {
      existing = await ctx.db
        .query("emails")
        .withIndex("by_message_id", (q) => q.eq("messageId", args.messageId))
        .unique();
    }
    if (!existing) {
      const candidates = await ctx.db
        .query("emails")
        .withIndex("by_sender_subject", (q) => q.eq("fromAddress", args.fromAddress).eq("subject", args.subject))
        .collect();
      existing = candidates.find((e) => e.body === args.body) ?? null;
    }
    if (!existing || !existing.billKey) return null;
    const bill = await ctx.db
      .query("bills")
      .withIndex("by_key", (q) => q.eq("key", existing!.billKey!))
      .unique();
    if (!bill) return null;
    return { billKey: bill.key, supplierKey: bill.supplierKey, status: bill.status };
  },
});

export const recordUnknownSender = internalMutation({
  args: {
    from: v.string(),
    fromDomain: v.string(),
    subject: v.string(),
    body: v.string(),
    receivedAt: v.string(),
    messageId: v.optional(v.string()),
    // Why it wasn't onboarded as a new supplier: a look-alike domain or a fraud playbook match.
    checks: v.optional(v.array(checkValidator)),
  },
  handler: async (ctx, args): Promise<{ billKey: string; supplierKey: string; status: "Needs you" }> => {
    const co = await getCompany(ctx);
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
      messageId: args.messageId,
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
      checks: args.checks ?? [],
    });
    const flagged = (args.checks ?? []).find((c) => c.state === "flag");
    await ctx.db.insert("activity", activity(
      "callback",
      "Flagged an email from an unrecognized sender",
      flagged ? flagged.evidence : `No ${co.payee.one} record matches ${args.fromDomain || "this sender"}. ${co.maya.name} needs to review it by hand.`,
      "bill",
      billKey,
    ));
    return { billKey, supplierKey, status: "Needs you" };
  },
});

/** The bill row, as Checking with nothing checked yet. addChecks and settleBill fill it in live. */
export const startBill = internalMutation({
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
    messageId: v.optional(v.string()),
    // Maya said a message hold sorted away is a bill: the bill reuses that email row.
    existingEmailKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ billKey: string; supplierKey: string; status: Doc<"bills">["status"] }> => {
    const co = await getCompany(ctx);
    const limit = wholeDollars(co.approvalLimitCents);
    const billKey = freshKey("bill_in");

    const existing = args.existingEmailKey
      ? await ctx.db
          .query("emails")
          .withIndex("by_key", (q) => q.eq("key", args.existingEmailKey!))
          .unique()
      : null;
    const emailKey = existing?.key ?? freshKey("email_in");
    if (existing) {
      await ctx.db.patch(existing._id, { billKey, ...(existing.triage ? { triage: { ...existing.triage, status: "done" as const } } : {}) });
    } else {
      await ctx.db.insert("emails", {
        key: emailKey,
        billKey,
        fromAddress: parseSenderAddress(args.from),
        fromDomain: args.fromDomain,
        subject: args.subject,
        body: args.body,
        receivedAt: args.receivedAt,
        direction: "in",
        messageId: args.messageId,
      });
    }
    await ctx.db.insert("bills", {
      key: billKey,
      supplierKey: args.supplier.key,
      invoiceNo: args.invoiceNo,
      amountCents: args.amountCents,
      currency: "USD",
      dueDate: args.receivedAt,
      receivedAt: args.receivedAt,
      bankAccountKey: args.bankAccountKey,
      status: "Checking",
      emailKey,
      planted: false,
      checks: [],
    });

    return { billKey, supplierKey: args.supplier.key, status: "Checking" as Doc<"bills">["status"] };
  },
});

/** Appends checks to a Checking bill as they finish, so the page shows them arriving. */
export const addChecks = internalMutation({
  args: { billKey: v.string(), checks: v.array(checkValidator) },
  handler: async (ctx, args): Promise<void> => {
    const bill = await ctx.db.query("bills").withIndex("by_key", (q) => q.eq("key", args.billKey)).unique();
    if (bill) await ctx.db.patch(bill._id, { checks: [...(bill.checks ?? []), ...args.checks] });
  },
});

/** Every check is in: the decision sets the status and starts the call, approval or payment. */
export const settleBill = internalMutation({
  args: {
    billKey: v.string(),
    supplier: v.object({ key: v.string(), name: v.string(), trustedPhone: v.string() }),
    amountCents: v.number(),
    invoiceNo: v.string(),
    checks: v.array(checkValidator),
    decision: v.union(v.literal("pay"), v.literal("ask_dev"), v.literal("call")),
  },
  handler: async (ctx, args): Promise<{ billKey: string; supplierKey: string; status: Doc<"bills">["status"] }> => {
    const bill = await ctx.db.query("bills").withIndex("by_key", (q) => q.eq("key", args.billKey)).unique();
    if (!bill) throw new Error("bill not found");
    const billKey = args.billKey;
    const co = await getCompany(ctx);
    const limit = wholeDollars(co.approvalLimitCents);
    const status: Doc<"bills">["status"] = args.decision === "pay" ? "Scheduled" : args.decision === "ask_dev" ? "Needs you" : "Calling";
    await ctx.db.patch(bill._id, { status, checks: args.checks });
    const flaggedLabels = args.checks.filter((c) => c.state === "flag").map((c) => c.label);
    const money = fmtMoney(args.amountCents);

    if (args.decision === "pay") {
      await ctx.db.insert("activity", activity(
        "callback",
        `Scheduled ${money} for ${args.supplier.name} (invoice #${args.invoiceNo})`,
        `Every check passed and it's under the ${limit} limit.`,
        "bill",
        billKey,
      ));
    } else if (args.decision === "ask_dev") {
      const route = routeEscalation(args.checks, args.amountCents, { company: co });
      await ctx.db.insert("approvals", {
        key: freshKey("appr"),
        billKey,
        kind: "big_payment",
        status: "pending",
        recommendation: `Every check passed. This is ${money}, over hold's ${limit} limit, so it needs ${co.dev.name}'s approval.`,
        routedTo: route.routedTo,
        reason: route.reason,
        thread: [],
      });
      await ctx.db.insert("activity", activity(
        "callback",
        `Asked ${co.dev.name} to approve ${money} for ${args.supplier.name} (#${args.invoiceNo})`,
        `Safe, but over the ${limit} limit hold can pay on its own.`,
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

/** A supplier email that isn't a bill: kept as a message for Maya, or filed on the supplier. */
export const recordMessage = internalMutation({
  args: {
    from: v.string(),
    fromDomain: v.string(),
    subject: v.string(),
    body: v.string(),
    receivedAt: v.string(),
    messageId: v.optional(v.string()),
    supplier: v.object({ key: v.string(), name: v.string() }),
    triage: v.object({
      kindKey: v.optional(v.string()),
      kindName: v.string(),
      route: v.union(v.literal("to_maya"), v.literal("file")),
      why: v.string(),
      quote: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<{ billKey: string; emailKey: string; supplierKey: string; status: string }> => {
    const co = await getCompany(ctx);
    const emailKey = freshKey("email_in");
    await ctx.db.insert("emails", {
      key: emailKey,
      billKey: null,
      fromAddress: parseSenderAddress(args.from),
      fromDomain: args.fromDomain,
      subject: args.subject,
      body: args.body,
      receivedAt: args.receivedAt,
      direction: "in",
      messageId: args.messageId,
      triage: { ...args.triage, supplierKey: args.supplier.key, status: args.triage.route === "file" ? "filed" : "open" },
    });
    await ctx.db.insert("activity", activity(
      "callback",
      args.triage.route === "file"
        ? `Filed an email from ${args.supplier.name} (${args.triage.kindName})`
        : `Sent an email from ${args.supplier.name} to ${co.maya.name} (${args.triage.kindName})`,
      args.triage.why,
      "email",
      emailKey,
    ));
    return { billKey: "", emailKey, supplierKey: args.supplier.key, status: args.triage.route === "file" ? "Filed" : "Needs you" };
  },
});

// ---------- entry point ----------

type IngestArgs = { from: string; subject: string; body: string; receivedAt: string; messageId?: string };
type IngestResult = { billKey: string; supplierKey: string; status: string; emailKey?: string };

export const ingestEmail = action({
  args: { from: v.string(), subject: v.string(), body: v.string(), receivedAt: v.string(), messageId: v.optional(v.string()) },
  handler: (ctx, args): Promise<IngestResult> => ingest(ctx, args),
});

/**
 * Maya says a message hold sorted away is a bill: run it through the bill checks, reusing the
 * email row. Internal, so the bill path can't be skipped from outside.
 */
export const fileAsBill = internalAction({
  args: { emailKey: v.string() },
  handler: async (ctx, { emailKey }): Promise<IngestResult | null> => {
    const email = await ctx.runQuery(internal.app.intake.emailForBill, { emailKey });
    if (!email || email.billKey) return null;
    return ingest(ctx, { from: email.fromAddress, subject: email.subject, body: email.body, receivedAt: email.receivedAt }, { existingEmailKey: emailKey });
  },
});

export const emailForBill = internalQuery({
  args: { emailKey: v.string() },
  handler: (ctx, { emailKey }) =>
    ctx.db
      .query("emails")
      .withIndex("by_key", (q) => q.eq("key", emailKey))
      .unique(),
});

/**
 * An email from a domain no supplier uses. A look-alike of a known supplier, or one the fraud
 * playbook flags, goes to Maya as before; a bill from a genuine newcomer starts onboarding a New
 * supplier (convex/app/onboarding.ts); anything else is a message for Maya.
 */
async function fromUnknownDomain(ctx: ActionCtx, args: IngestArgs, fromAddress: string, fromDomain: string): Promise<IngestResult> {
  const unknown = (checks?: Check[]) =>
    ctx.runMutation(internal.app.intake.recordUnknownSender, {
      from: args.from,
      fromDomain,
      subject: args.subject,
      body: args.body,
      receivedAt: args.receivedAt,
      messageId: args.messageId,
      checks,
    });
  const cite = { kind: "email" as const, ref: fromAddress };

  // The nightly Apify watch may already know this domain; otherwise compare names by edit distance.
  const watched = fromDomain ? await ctx.runQuery(internal.app.watch.watchedDomain, { domain: fromDomain }) : null;
  const imitates = watched
    ? { name: watched.supplierName, domain: watched.imitates }
    : lookalikeOf(fromDomain, await ctx.runQuery(internal.app.onboarding.knownSuppliers, {}));
  if (imitates) {
    const evidence = watched
      ? `hold's nightly look-alike watch has tracked ${fromDomain} since ${watched.firstSeenAt.slice(0, 10)}: a look-alike of ${imitates.name}'s ${imitates.domain} (${watched.technique})` +
        (watched.registeredDaysAgo !== undefined ? `, registered ${watched.registeredDaysAgo} day${watched.registeredDaysAgo === 1 ? "" : "s"} ago.` : ".")
      : `${fromDomain} looks like ${imitates.name}'s ${imitates.domain} but isn't it: someone imitating a supplier, not a new one.`;
    const flagged = await unknown([{ id: "domain", label: "Look-alike domain", state: "flag", evidence, quote: fromAddress, cite }]);
    await ctx.scheduler.runAfter(0, internal.app.background.copycatOnBill, { billKey: flagged.billKey, domain: fromDomain, knownDomain: imitates.domain, fromAddress });
    return flagged;
  }
  if (!fromDomain) return unknown();

  const amountCents = parseAmountCents(args.body) ?? 0;
  const co = await ctx.runQuery(api.app.company.current, {});
  const playbook = forChannel(await ctx.runQuery(internal.app.techniques.activePlaybook, {}), "email");
  const [read, assessed] = await Promise.allSettled([
    readNewcomer(anthropic(), { from: args.from, subject: args.subject, body: args.body }),
    assessEmail(anthropic(), { fromAddress, subject: args.subject, body: args.body, supplierName: `a company ${co.name} has no record of`, supplierDomain: fromDomain, amountCents, company: co }, playbook),
  ]);
  if (read.status === "rejected") {
    console.warn(`reading a new sender's email failed for ${fromDomain}:`, read.reason);
    return unknown();
  }
  const fraud = assessed.status === "fulfilled" ? techniqueCheck(assessed.value, playbook, fromAddress) : undefined;
  if (fraud?.state === "flag") return unknown([fraud]);
  if (!read.value.isBill) {
    return ctx.runMutation(internal.app.intake.recordMessage, {
      from: args.from,
      fromDomain,
      subject: args.subject,
      body: args.body,
      receivedAt: args.receivedAt,
      messageId: args.messageId,
      supplier: { key: `unknown:${fromDomain}`, name: read.value.companyName || fromDomain },
      triage: { kindName: "From an unknown sender", route: "to_maya", why: `${fromDomain} isn't a ${co.payee.one} ${co.name} knows. ${read.value.whatFor}`.trim() },
    });
  }
  return ctx.runMutation(internal.app.onboarding.onboardFromEmail, {
    from: args.from,
    fromAddress,
    fromDomain,
    subject: args.subject,
    body: args.body,
    receivedAt: args.receivedAt,
    messageId: args.messageId,
    companyName: read.value.companyName,
    contactName: read.value.contactName,
    whatFor: read.value.whatFor,
    invoiceNo: parseInvoiceNo(args.body) ?? "unknown",
    amountCents,
    extraChecks: fraud ? [fraud] : [],
  });
}

async function ingest(ctx: ActionCtx, args: IngestArgs, opts: { existingEmailKey?: string } = {}): Promise<IngestResult> {
    const fromDomain = parseSenderDomain(args.from);
    const fromAddress = parseSenderAddress(args.from);

    if (!opts.existingEmailKey) {
      const duplicate = await ctx.runQuery(internal.app.intake.findDuplicateEmail, {
        messageId: args.messageId,
        fromAddress,
        subject: args.subject,
        body: args.body,
      });
      if (duplicate) return duplicate;
    }

    const context: IntakeContext | null = await ctx.runQuery(internal.app.intake.gatherIntakeContext, {
      fromDomain,
      fromAddress,
      subject: args.subject,
      body: args.body,
    });

    if (!context) return await fromUnknownDomain(ctx, args, fromAddress, fromDomain);

    const amountCents = parseAmountCents(args.body) ?? 0;
    const co = await ctx.runQuery(api.app.company.current, {});

    const playbook = forChannel(await ctx.runQuery(internal.app.techniques.activePlaybook, {}), "email");
    const emailKinds = toKinds(await ctx.runQuery(internal.app.techniques.activePlaybook, { job: "triage" }));
    const invoiceNo = parseInvoiceNo(args.body) ?? "unknown";
    const checkInput = {
      email: { body: args.body, fromAddress, fromDomain },
      supplier: { key: context.supplier.key, name: context.supplier.name, domain: context.supplier.domain },
      currentBankAccount: context.currentBankAccount,
      pastPaidBankAccounts: context.pastPaidBankAccounts,
      pastPaidAmounts: context.pastPaidAmounts,
      amountCents,
      learnedRules: context.learnedRules,
      company: co,
    };

    // The three Claude checks start together and are awaited where they're used. Any can fail
    // (no ANTHROPIC_API_KEY, Moss down): that check shows as info rather than blocking intake.
    const styleP = ctx.runAction(api.voice.styleMatch.styleMatch, { supplier_id: context.supplier.key, email_text: args.body });
    const techniqueP = assessEmail(
      anthropic(),
      { fromAddress, subject: args.subject, body: args.body, supplierName: context.supplier.name, supplierDomain: context.supplier.domain, amountCents, company: co },
      playbook,
    );
    // A message being converted to a bill has already been sorted, so it skips triage.
    const triageP = opts.existingEmailKey
      ? Promise.resolve(null)
      : judgeEmail(anthropic(), { fromAddress, subject: args.subject, body: args.body, supplierName: context.supplier.name }, emailKinds);
    // Avoid unhandled rejections while another one is being awaited.
    for (const p of [styleP, techniqueP, triageP]) p.catch(() => undefined);

    const styleResult = async (): Promise<Check> => {
      try {
        const r = await styleP;
        return runChecks({ ...checkInput, styleMatch: { matches: r.matches, reasons: r.reasons } }).find((c) => c.id === "writing-style")!;
      } catch (err) {
        console.warn(`styleMatch failed for ${context.supplier.key}:`, err);
        const why = err instanceof Error ? err.message : String(err);
        return { id: "writing-style", label: "Writing style", state: "info", evidence: `Writing style wasn't checked: ${why}`, cite: { kind: "email", ref: fromAddress } };
      }
    };
    const techniqueResult = async (): Promise<Check> => {
      try {
        return techniqueCheck(await techniqueP, playbook, fromAddress);
      } catch (err) {
        return {
          id: "fraud-technique",
          label: "Fraud technique",
          state: "info",
          evidence: `Fraud techniques weren't checked: ${err instanceof Error ? err.message : String(err)}`,
          cite: { kind: "email", ref: fromAddress },
        };
      }
    };

    // Inbox triage (job #2): an email that isn't a bill never becomes one. Anything a fraud check
    // flags still goes through the bill checks and a check call; if triage fails, intake carries on.
    let triaged: Awaited<typeof triageP> = null;
    try {
      triaged = await triageP;
    } catch (err) {
      console.warn(`triage failed for ${context.supplier.key}:`, err);
    }
    let early: { style: Check; technique: Check } | undefined;
    if (triaged) {
      const hasAmount = parseAmountCents(args.body) !== null;
      let sorted = routeEmail(triaged, emailKinds, { hasAmount, fraudFlagged: false });
      if (sorted.route !== "bill") {
        // Not a bill unless a fraud check flags it, which needs the other checks first.
        early = { style: await styleResult(), technique: await techniqueResult() };
        const checks = [...runChecks(checkInput), early.style, early.technique];
        const fraudFlagged = checks.some((c) => ["fraud-technique", "bank-account", "domain"].includes(c.id) && c.state === "flag");
        sorted = routeEmail(triaged, emailKinds, { hasAmount, fraudFlagged });
        if (sorted.route !== "bill") {
          return await ctx.runMutation(internal.app.intake.recordMessage, {
            from: args.from,
            fromDomain,
            subject: args.subject,
            body: args.body,
            receivedAt: args.receivedAt,
            messageId: args.messageId,
            supplier: { key: context.supplier.key, name: context.supplier.name },
            triage: { kindKey: sorted.kindKey, kindName: sorted.kindName, route: sorted.route, why: sorted.why, quote: triaged.quote || undefined },
          });
        }
      }
    }

    // It's a bill: it appears now, as Checking, and each check lands on it as it finishes.
    const supplier = { key: context.supplier.key, name: context.supplier.name, trustedPhone: context.supplier.trustedPhone };
    const started = await ctx.runMutation(internal.app.intake.startBill, {
      from: args.from,
      fromDomain,
      subject: args.subject,
      body: args.body,
      receivedAt: args.receivedAt,
      supplier,
      bankAccountKey: context.currentBankAccountKey,
      amountCents,
      invoiceNo,
      messageId: args.messageId,
      existingEmailKey: opts.existingEmailKey,
    });
    const show = (checks: Check[]) => ctx.runMutation(internal.app.intake.addChecks, { billKey: started.billKey, checks });
    if (fromDomain && fromDomain !== context.supplier.domain) {
      await ctx.scheduler.runAfter(0, internal.app.background.copycatOnBill, { billKey: started.billKey, domain: fromDomain, knownDomain: context.supplier.domain, fromAddress });
    }
    const checks = runChecks(checkInput); // bank, domain, rush, amount, learned rule: lookups, not models
    await show(checks);
    const style = early?.style ?? (await styleResult());
    await show([style]);
    const technique = early?.technique ?? (await techniqueResult());
    await show([technique]);
    checks.push(style, technique);

    let decision: Decision = decide(checks, amountCents, co);
    // New-supplier addendum (plan-agent.md addendum §3): a bank change or a bill of $5,000+ from
    // a supplier hold hasn't confirmed by call yet always gets a call, even if every check
    // passed (there's simply no history to trust yet).
    if (context.supplier.status === "new" && decision !== "call") {
      const bankFlagged = checks.find((c) => c.id === "bank-account")?.state === "flag";
      if (bankFlagged || amountCents >= NEW_SUPPLIER_CALL_THRESHOLD_CENTS) decision = "call";
    }

    return await ctx.runMutation(internal.app.intake.settleBill, { billKey: started.billKey, supplier, amountCents, invoiceNo, checks, decision });
}
