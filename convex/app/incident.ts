// After a check call proves a bill was a scam, hold treats it as an incident without being asked:
// it blocks the account the scammer asked for, then holds every other unpaid bill that pays that
// account or asks for it, whoever it claims to be from. Intake flags later emails that ask for a
// blocked account (convex/app/intake.ts), and only Dev can release a bill held this way (lib/policy.ts).
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { blockedAccountCheck, sameAccount, type BlockedAccountInput } from "./checks.js";
import { getCompany } from "./company.js";
import { parseBankDetails } from "./intake.js";

const UNPAID: Doc<"bills">["status"][] = ["Scheduled", "Checking", "Calling", "Needs you"];

export async function sweepScamAccount(ctx: MutationCtx, scamBill: Doc<"bills">, impersonated: string, emailBody: string): Promise<void> {
  const account = parseBankDetails(emailBody);
  if (!account) return;
  const co = await getCompany(ctx);
  const now = new Date().toISOString();
  const label = `${account.bank} ··${account.last4}`;
  const log = (what: string, why: string, refKey: string) =>
    ctx.db.insert("activity", { key: `act_${crypto.randomUUID()}`, actor: "callback", what, why, refKind: "bill", refKey, at: now });

  const blocked: BlockedAccountInput = { ...account, sourceBillKey: scamBill.key, impersonated };
  const existing = await ctx.db
    .query("blockedAccounts")
    .withIndex("by_last4", (q) => q.eq("last4", account.last4))
    .collect();
  if (!existing.some((b) => sameAccount(b, account))) {
    await ctx.db.insert("blockedAccounts", { key: `blk_${crypto.randomUUID()}`, ...blocked, blockedAt: now });
    await log(`blocked ${label}`, `The real ${impersonated} said on the check call that this account isn't theirs. hold holds any ${co.bill.one} that pays it or asks for it.`, scamBill.key);
  }

  const accounts = new Map((await ctx.db.query("bankAccounts").collect()).map((a) => [a.key, a]));
  const found: string[] = [];
  for (const status of UNPAID) {
    const rows = await ctx.db
      .query("bills")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
    for (const bill of rows) {
      if (bill.key === scamBill.key || bill.practice) continue;
      const paid = accounts.get(bill.bankAccountKey);
      const email = await ctx.db
        .query("emails")
        .withIndex("by_key", (q) => q.eq("key", bill.emailKey))
        .unique();
      const asked = email ? parseBankDetails(email.body) : null;
      const pays = paid !== undefined && sameAccount(paid, account);
      if (!pays && !(asked && sameAccount(asked, account))) continue;

      const supplier = await ctx.db
        .query("suppliers")
        .withIndex("by_key", (q) => q.eq("key", bill.supplierKey))
        .unique();
      const name = supplier?.name ?? bill.supplierKey;
      const check = blockedAccountCheck(blocked, pays ? "pays" : "asks to pay", co);
      await ctx.db.patch(bill._id, { status: "Held", checks: [...(bill.checks ?? []).filter((c) => c.id !== check.id), check] });
      // Its account on file is the scammer's, so nothing else from this payee can be trusted yet.
      if (pays && supplier) await ctx.db.patch(supplier._id, { status: "under_review" });

      const approval = {
        kind: "held_payment" as const,
        routedTo: "dev" as const,
        reason: check.evidence,
        recommendation: `Don't pay this ${co.bill.one}. ${check.evidence}`,
      };
      const pending = await ctx.db
        .query("approvals")
        .withIndex("by_bill", (q) => q.eq("billKey", bill.key))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (pending) await ctx.db.patch(pending._id, approval);
      else await ctx.db.insert("approvals", { key: `appr_${crypto.randomUUID()}`, billKey: bill.key, status: "pending", thread: [], ...approval });

      await log(`held this ${co.bill.one}: it ${pays ? "pays" : "asks to pay"} a blocked account`, check.evidence, bill.key);
      found.push(`${name} #${bill.invoiceNo}`);
    }
  }
  if (found.length > 0) {
    const n = found.length === 1 ? `1 more ${co.bill.one}` : `${found.length} more ${co.bill.many}`;
    await log(`found ${label} on ${n} and held ${found.length === 1 ? "it" : "them"}`, `${found.join(", ")}. Same account the ${impersonated} impersonator asked for.`, scamBill.key);
  }
}
