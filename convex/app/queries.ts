// Read-only screens: Inbox, bill page, Approvals, Payments, Activity log, Suppliers.
// Every handler maps Convex table rows onto the shapes in lib/types.ts (the same shapes
// lib/data.ts returns from the JSON fixture), so swapping the data source there is a
// drop-in change. Calls are joined from the voice-owned callRequests/callResults/callEvents
// tables (shapes fixed by plan-agent.md's interface contract; never changed here).
// TODO(auth): these are public until the app adds team login; then guard them with ctx.auth.
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";
import { query, type QueryCtx } from "../_generated/server.js";
import type {
  ActivityEntry,
  Approval,
  BankAccount,
  Bill,
  Call,
  CallTurn,
  DataBillStatus,
  Email,
  Payment,
  Settings,
  Supplier,
} from "../../lib/types.js";

// ---------- row -> lib/types.ts mapping ----------

function toSupplier(s: Doc<"suppliers">): Supplier {
  return {
    key: s.key,
    name: s.name,
    category: s.category,
    domain: s.domain,
    contactName: s.contactName,
    contactEmail: s.contactEmail,
    trustedPhone: s.trustedPhone,
    phoneLastCheckedAt: s.phoneLastCheckedAt,
    status: s.status,
    onboarding: s.onboarding,
    language: s.language,
    phoneMenu: s.phoneMenu,
    timeZone: s.timeZone,
  };
}

function toBankAccount(b: Doc<"bankAccounts">): BankAccount {
  return {
    key: b.key,
    supplierKey: b.supplierKey,
    bank: b.bank,
    last4: b.last4,
    routingLast4: b.routingLast4,
    status: b.status,
    verifiedBy: b.verifiedBy,
    addedAt: b.addedAt,
  };
}

function toEmail(e: Doc<"emails">): Email {
  return {
    key: e.key,
    billKey: e.billKey,
    fromAddress: e.fromAddress,
    fromDomain: e.fromDomain,
    subject: e.subject,
    body: e.body,
    receivedAt: e.receivedAt,
    direction: e.direction,
  };
}

function toPayment(p: Doc<"payments">): Payment {
  return {
    key: p.key,
    billKey: p.billKey,
    amountCents: p.amountCents,
    bankAccountKey: p.bankAccountKey,
    status: p.status,
    transferId: p.transferId,
    paidAt: p.paidAt,
  };
}

/** The bill's most recent call request, joined with its result and segment transcript, if any. */
async function toCall(ctx: QueryCtx, billKey: string, supplierKey: string): Promise<Call | null> {
  const requests = await ctx.db
    .query("callRequests")
    .withIndex("by_bill", (q) => q.eq("bill_id", billKey))
    .collect();
  if (requests.length === 0) return null;
  const request = requests.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
  const result = await ctx.db
    .query("callResults")
    .withIndex("by_call", (q) => q.eq("call_id", request.call_id))
    .unique();
  if (!result) return null;
  const events = await ctx.db
    .query("callEvents")
    .withIndex("by_call", (q) => q.eq("call_id", request.call_id))
    .collect();
  const transcript: CallTurn[] = events.flatMap((e) =>
    e.type === "segment" && (e.speaker === "callback" || e.speaker === "supplier")
      ? [{ speaker: e.speaker, text: e.text, ts: e.ts }]
      : [],
  );
  return {
    key: request.call_id,
    supplierKey,
    billKey,
    direction: "out",
    startedAt: result.startedAt ?? request.startedAt ?? "",
    summary: result.summary,
    transcript,
    outcome: result.outcome,
  };
}

const UNKNOWN_SENDER_PREFIX = "unknown:";

// recordUnknownSender (convex/app/intake.ts) points a bill at a sentinel supplierKey/empty
// bankAccountKey instead of real rows. These placeholders let listBills/listApprovals/the bill
// page render that bill instead of throwing; a genuine dangling reference anywhere else still
// throws below.
function placeholderSupplier(supplierKey: string, fromAddress: string): Supplier {
  return {
    key: supplierKey,
    name: "Unknown sender",
    category: "other",
    domain: supplierKey.slice(UNKNOWN_SENDER_PREFIX.length),
    contactName: fromAddress,
    contactEmail: fromAddress,
    trustedPhone: "",
    phoneLastCheckedAt: "",
    status: "new",
  };
}

// ponytail: BankAccount's verifiedBy union has no "unverified" literal; "onboarding" is its
// lowest-trust value. Upgrade if an actual unverified state is ever needed elsewhere.
function placeholderBankAccount(supplierKey: string): BankAccount {
  return {
    key: "",
    supplierKey,
    bank: "Not on file",
    last4: "----",
    routingLast4: "----",
    status: "retired",
    verifiedBy: "onboarding",
    addedAt: "",
  };
}

async function requireSupplier(ctx: QueryCtx, key: string): Promise<Doc<"suppliers">> {
  const row = await ctx.db
    .query("suppliers")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) throw new Error(`Unknown supplier ${key}`);
  return row;
}

export async function hydrateBill(ctx: QueryCtx, bill: Doc<"bills">): Promise<Bill> {
  const isUnknownSender = bill.supplierKey.startsWith(UNKNOWN_SENDER_PREFIX) && bill.bankAccountKey === "";
  // A new supplier's first bill has no account on file yet: Fogline only pays one it verified.
  const noAccount = bill.bankAccountKey === "";
  const [supplierRow, bankAccountRow, emailRow, paymentRow, call] = await Promise.all([
    isUnknownSender ? Promise.resolve(null) : requireSupplier(ctx, bill.supplierKey),
    noAccount
      ? Promise.resolve(null)
      : ctx.db
          .query("bankAccounts")
          .withIndex("by_key", (q) => q.eq("key", bill.bankAccountKey))
          .unique(),
    ctx.db
      .query("emails")
      .withIndex("by_key", (q) => q.eq("key", bill.emailKey))
      .unique(),
    ctx.db
      .query("payments")
      .withIndex("by_bill", (q) => q.eq("billKey", bill.key))
      .first(),
    toCall(ctx, bill.key, bill.supplierKey),
  ]);
  if (!noAccount && !bankAccountRow) throw new Error(`Bill ${bill.key} references an unknown bank account ${bill.bankAccountKey}`);
  if (!emailRow) throw new Error(`Bill ${bill.key} references an unknown email ${bill.emailKey}`);
  return {
    key: bill.key,
    supplierKey: bill.supplierKey,
    invoiceNo: bill.invoiceNo,
    amountCents: bill.amountCents,
    currency: bill.currency,
    dueDate: bill.dueDate,
    receivedAt: bill.receivedAt,
    bankAccountKey: bill.bankAccountKey,
    status: bill.status,
    emailKey: bill.emailKey,
    planted: bill.planted,
    supplier: supplierRow ? toSupplier(supplierRow) : placeholderSupplier(bill.supplierKey, emailRow.fromAddress),
    bankAccount: bankAccountRow ? toBankAccount(bankAccountRow) : placeholderBankAccount(bill.supplierKey),
    email: toEmail(emailRow),
    payment: paymentRow ? toPayment(paymentRow) : null,
    call,
    checks: bill.checks ?? [],
  };
}

// ---------- public queries ----------

export const listBills = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }): Promise<Bill[]> => {
    const rows = status
      ? await ctx.db
          .query("bills")
          .withIndex("by_status", (q) => q.eq("status", status as DataBillStatus))
          .collect()
      : await ctx.db.query("bills").collect();
    const bills = await Promise.all(rows.filter((r) => !r.practice).map((row) => hydrateBill(ctx, row)));
    return bills.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  },
});

export const getBill = query({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<Bill | null> => {
    const row = await ctx.db
      .query("bills")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row ? hydrateBill(ctx, row) : null;
  },
});

export const listApprovals = query({
  args: {},
  handler: async (ctx): Promise<Approval[]> => {
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const approvals = (
      await Promise.all(
        rows.map(async (row) => {
          const billRow = await ctx.db
            .query("bills")
            .withIndex("by_key", (q) => q.eq("key", row.billKey))
            .unique();
          if (!billRow) throw new Error(`Approval ${row.key} references an unknown bill ${row.billKey}`);
          if (billRow.practice) return null;
          const bill = await hydrateBill(ctx, billRow);
          // The safe alternative to a changed account: the payee's oldest active account that isn't this one.
          const verified = (
            await ctx.db
              .query("bankAccounts")
              .withIndex("by_supplier", (q) => q.eq("supplierKey", bill.supplierKey))
              .collect()
          )
            .filter((a) => a.status === "active" && a.key !== bill.bankAccountKey)
            .sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0];
          const approval: Approval = {
            key: row.key,
            billKey: row.billKey,
            bill,
            kind: row.kind,
            status: "pending",
            recommendation: row.recommendation,
            routedTo: row.routedTo,
            reason: row.reason,
            thread: row.thread,
            ...(verified ? { verifiedAccount: { key: verified.key, bank: verified.bank, last4: verified.last4 } } : {}),
          };
          return approval;
        }),
      )
    ).filter((a): a is Approval => a !== null);
    return approvals.sort((a, b) => (a.bill.receivedAt < b.bill.receivedAt ? 1 : -1));
  },
});

export const listPayments = query({
  args: {},
  handler: async (ctx): Promise<Array<Payment & { bill: Bill }>> => {
    const rows = await ctx.db.query("payments").collect();
    const out = (
      await Promise.all(
        rows.map(async (row) => {
          const billRow = await ctx.db
            .query("bills")
            .withIndex("by_key", (q) => q.eq("key", row.billKey))
            .unique();
          if (!billRow) throw new Error(`Payment ${row.key} references an unknown bill ${row.billKey}`);
          if (billRow.practice) return null;
          const bill = await hydrateBill(ctx, billRow);
          return { ...toPayment(row), bill };
        }),
      )
    ).filter((p): p is Payment & { bill: Bill } => p !== null);
    return out.sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1));
  },
});

export const listActivity = query({
  args: {},
  handler: async (ctx): Promise<ActivityEntry[]> => {
    const rows = await ctx.db.query("activity").collect();
    const entries: ActivityEntry[] = rows.map((row) => ({
      key: row.key,
      actor: row.actor,
      what: row.what,
      why: row.why,
      refKind: row.refKind,
      refKey: row.refKey,
      at: row.at,
    }));
    return entries.sort((a, b) => (a.at < b.at ? 1 : -1));
  },
});

export const listSuppliers = query({
  args: {},
  handler: async (ctx): Promise<Supplier[]> => {
    const rows = await ctx.db.query("suppliers").collect();
    return rows.map(toSupplier).sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getSupplier = query({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<Supplier | null> => {
    const row = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row ? toSupplier(row) : null;
  },
});

/** Every bank account on file for a supplier, including ones no bill points at. No full numbers. */
export const listBankAccountsForSupplier = query({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }): Promise<BankAccount[]> => {
    const rows = await ctx.db
      .query("bankAccounts")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplierKey))
      .collect();
    return rows.map(toBankAccount).sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1));
  },
});

/** Finished calls about a supplier's bills, newest first. */
export const listCallsForSupplier = query({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }): Promise<Call[]> => {
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplierKey))
      .collect();
    const calls = await Promise.all(bills.map((b) => toCall(ctx, b.key, supplierKey)));
    return calls.filter((c): c is Call => c !== null).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  },
});

/** Open (not Paid/Scheduled) bill count per supplier, for the Suppliers overview's "open items"
 * column (plan-agent.md addendum §3); each count links back to that supplier's own bill list. */
export const listSupplierSummaries = query({
  args: {},
  handler: async (ctx): Promise<Array<Supplier & { openItems: number }>> => {
    const [suppliers, bills] = await Promise.all([ctx.db.query("suppliers").collect(), ctx.db.query("bills").collect()]);
    const openBySupplier = new Map<string, number>();
    for (const b of bills) {
      if (b.practice) continue;
      if (b.status === "Paid" || b.status === "Scheduled") continue;
      openBySupplier.set(b.supplierKey, (openBySupplier.get(b.supplierKey) ?? 0) + 1);
    }
    return suppliers
      .map((s) => ({ ...toSupplier(s), openItems: openBySupplier.get(s.key) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** The global Watch only setting, read wherever payBill/decideApproval enforce it (and by
 * the Payments page toggle). Absent row (no one has flipped it yet) means off. */
export async function getWatchOnlySetting(ctx: QueryCtx): Promise<boolean> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  return row?.watchOnly ?? false;
}

export const getSettings = query({
  args: {},
  handler: async (ctx): Promise<Settings> => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    return { watchOnly: await getWatchOnlySetting(ctx), away: row?.away === true, incomingLoadedAt: row?.incomingLoadedAt };
  },
});
