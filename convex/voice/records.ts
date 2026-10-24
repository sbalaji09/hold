// The ONLY place voice reads the app's supplier data (suppliers, bills, emails, payments,
// bankAccounts, past calls), mapped onto the contract's SupplierProfile / SupplierRecord.
// If the app schema changes, this is the one file to update.
//
// History excludes anything tied to a planted (scam) bill: those are not the supplier's real
// history, so they must never feed call questions or the writing-style baseline.
// Bank account numbers are never included: this text is indexed in Moss and read on calls.
import { v } from "convex/values";
import type { SupplierProfile, SupplierRecord } from "../../shared/contract.js";
import type { Doc } from "../_generated/dataModel.js";
import { internalQuery, type QueryCtx } from "../_generated/server.js";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09-03T16:00:00.000Z" -> "3 Sep" (fixed names and UTC, so it never depends on ICU or shifts a day). */
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
};

/** "2026-09-01T..." -> "September 2026": spelled out so "your September invoice" finds it in Moss. */
const monthYear = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const isoDay = (iso: string) => iso.slice(0, 10);

/** Masks account / routing digits ("account ending 2210", "··8817") in free text. */
export const redactAccounts = (text: string) =>
  text.replace(/(\b(?:account|acct|routing|ending)\b[^\d\n]{0,20}?|[·•*]{2}\s*)\d{4,}/gi, "$1[redacted]");

/** "Stagecraft Rigging Co." -> ["Stagecraft Rigging", "Stagecraft"]. */
export function aliasesFor(name: string): string[] {
  const base = name.replace(/[,\s]+(Co|Inc|LLC|Ltd|Corp)\.?$/i, "").trim();
  const first = base.split(/\s+/)[0] ?? base;
  return [...new Set([base, first])].filter((a) => a && a !== name);
}

function toProfile(s: Doc<"suppliers">): SupplierProfile {
  return { supplier_id: s.key, name: s.name, phone_on_file: s.trustedPhone, aliases: aliasesFor(s.name) };
}

async function supplierByKey(ctx: QueryCtx, key: string) {
  return ctx.db
    .query("suppliers")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** Display names for the Live call screen. */
export async function getSupplierContact(
  ctx: QueryCtx,
  supplier_id: string,
): Promise<{ name: string; contactName: string } | null> {
  const s = await supplierByKey(ctx, supplier_id);
  return s ? { name: s.name, contactName: s.contactName } : null;
}

export async function getSupplierProfile(ctx: QueryCtx, supplier_id: string): Promise<SupplierProfile | null> {
  const s = await supplierByKey(ctx, supplier_id);
  return s ? toProfile(s) : null;
}

export async function listSupplierProfiles(ctx: QueryCtx): Promise<SupplierProfile[]> {
  // ponytail: full scan; Fogline has ~25 suppliers. Paginate if this ever holds thousands.
  return (await ctx.db.query("suppliers").collect()).map(toProfile);
}

/** Everything voice may know about one supplier, oldest first. */
export async function getSupplierRecords(ctx: QueryCtx, supplier_id: string): Promise<SupplierRecord[]> {
  const supplier = await supplierByKey(ctx, supplier_id);
  if (!supplier) return [];

  const bills = await ctx.db
    .query("bills")
    .withIndex("by_supplier", (q) => q.eq("supplierKey", supplier_id))
    .collect();
  const planted = new Set(bills.filter((b) => b.planted).map((b) => b.key));
  const realBills = bills.filter((b) => !b.planted);
  // ponytail: emails has no supplier index, so this scans ~150 rows. Add an index on fromDomain if it grows.
  const allEmails = await ctx.db.query("emails").collect();
  const subjectByKey = new Map(allEmails.map((e) => [e.key, e.subject]));
  /** "Invoice #4471 — main-stage truss" -> " for main-stage truss". */
  const scopeOf = (emailKey: string) => {
    const scope = subjectByKey.get(emailKey)?.split(/\s[—–-]\s/)[1]?.trim();
    return scope ? ` for ${scope}` : "";
  };
  const out: SupplierRecord[] = [];

  for (const b of realBills) {
    out.push({
      id: b.key,
      supplier_id,
      kind: "invoice",
      ref: `#${b.invoiceNo}`,
      date: isoDay(b.receivedAt),
      amount_cents: b.amountCents,
      // Distinctive parts first (month, number, scope, total): embeddings weigh the opening most.
      text: `${monthYear(b.receivedAt)} invoice #${b.invoiceNo}${scopeOf(b.emailKey)}. Total ${usd(b.amountCents)}. From ${supplier.name}, received ${isoDay(b.receivedAt)}, due ${b.dueDate}, status ${b.status}.`,
    });
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_bill", (q) => q.eq("billKey", b.key))
      .collect();
    for (const p of payments) {
      out.push({
        id: p.key,
        supplier_id,
        kind: "payment",
        ref: `Payment ${shortDate(p.paidAt)}`,
        date: isoDay(p.paidAt),
        amount_cents: p.amountCents,
        text: `Fogline paid ${supplier.name} ${usd(p.amountCents)} for invoice #${b.invoiceNo} on ${isoDay(p.paidAt)}${p.transferId ? ` (transfer ${p.transferId})` : ""}. Status ${p.status}.`,
      });
    }
  }

  const emails = allEmails.filter(
    (e) => e.direction === "in" && e.fromDomain === supplier.domain && !(e.billKey && planted.has(e.billKey)),
  );
  for (const e of emails) {
    out.push({
      id: e.key,
      supplier_id,
      kind: "email",
      ref: `Email ${shortDate(e.receivedAt)}`,
      date: isoDay(e.receivedAt),
      text: `Subject: ${e.subject}\nFrom: ${e.fromAddress}\n\n${e.body}`,
    });
  }

  // Past calls: closed call requests with a result, plus their transcript.
  const calls = await ctx.db
    .query("callRequests")
    .withIndex("by_supplier", (q) => q.eq("supplier_id", supplier_id))
    .collect();
  for (const c of calls) {
    if (c.status !== "done" || planted.has(c.bill_id)) continue;
    const result = await ctx.db
      .query("callResults")
      .withIndex("by_call", (q) => q.eq("call_id", c.call_id))
      .unique();
    if (!result) continue;
    const segments = (
      await ctx.db
        .query("callEvents")
        .withIndex("by_call", (q) => q.eq("call_id", c.call_id))
        .collect()
    ).flatMap((e) => (e.type === "segment" ? [`${e.speaker}: ${e.text}`] : []));
    const when = c.startedAt ?? new Date(c._creationTime).toISOString();
    out.push({
      id: c.call_id,
      supplier_id,
      kind: "call",
      ref: `Call ${shortDate(when)}`,
      date: isoDay(when),
      text: [`Call with ${supplier.name} on ${isoDay(when)}. ${result.summary}`, ...segments].join("\n"),
    });
  }

  return out
    .map((r) => ({ ...r, text: redactAccounts(r.text) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** For actions (styleMatch fallback when Moss is unavailable). */
export const supplierRecords = internalQuery({
  args: { supplier_id: v.string() },
  handler: (ctx, { supplier_id }) => getSupplierRecords(ctx, supplier_id),
});
