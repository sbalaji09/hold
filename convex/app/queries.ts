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

async function requireSupplier(ctx: QueryCtx, key: string): Promise<Doc<"suppliers">> {
  const row = await ctx.db
    .query("suppliers")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) throw new Error(`Unknown supplier ${key}`);
  return row;
}

export async function hydrateBill(ctx: QueryCtx, bill: Doc<"bills">): Promise<Bill> {
  const [supplierRow, bankAccountRow, emailRow, paymentRow, call] = await Promise.all([
    requireSupplier(ctx, bill.supplierKey),
    ctx.db
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
  if (!bankAccountRow) throw new Error(`Bill ${bill.key} references an unknown bank account ${bill.bankAccountKey}`);
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
    supplier: toSupplier(supplierRow),
    bankAccount: toBankAccount(bankAccountRow),
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
    const bills = await Promise.all(rows.map((row) => hydrateBill(ctx, row)));
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
    const approvals = await Promise.all(
      rows.map(async (row) => {
        const billRow = await ctx.db
          .query("bills")
          .withIndex("by_key", (q) => q.eq("key", row.billKey))
          .unique();
        if (!billRow) throw new Error(`Approval ${row.key} references an unknown bill ${row.billKey}`);
        const bill = await hydrateBill(ctx, billRow);
        const approval: Approval = {
          key: row.key,
          billKey: row.billKey,
          bill,
          kind: row.kind,
          status: "pending",
          recommendation: row.recommendation,
          thread: row.thread,
        };
        return approval;
      }),
    );
    return approvals.sort((a, b) => (a.bill.receivedAt < b.bill.receivedAt ? 1 : -1));
  },
});

export const listPayments = query({
  args: {},
  handler: async (ctx): Promise<Array<Payment & { bill: Bill }>> => {
    const rows = await ctx.db.query("payments").collect();
    const out = await Promise.all(
      rows.map(async (row) => {
        const billRow = await ctx.db
          .query("bills")
          .withIndex("by_key", (q) => q.eq("key", row.billKey))
          .unique();
        if (!billRow) throw new Error(`Payment ${row.key} references an unknown bill ${row.billKey}`);
        const bill = await hydrateBill(ctx, billRow);
        return { ...toPayment(row), bill };
      }),
    );
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
