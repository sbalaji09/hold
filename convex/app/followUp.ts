// hold doesn't let a decision it's waiting on quietly miss a due date. Every 15 minutes
// (convex/crons.ts) it looks at approvals still pending: the day before a bill is due it texts the
// person it's waiting on, and if the due date passes undecided it pays nothing and texts Maya too.
// Each follow-up is claimed and logged in one mutation first, so a retry never texts twice.
import { v } from "convex/values";
import { internal } from "../_generated/api.js";
import { internalAction, internalMutation } from "../_generated/server.js";
import { getCompany } from "./company.js";

export type FollowUp = "remind" | "overdue" | null;

/** What a pending approval needs today (dates are YYYY-MM-DD in the company's time zone). Only a
 * due date that passed yesterday counts as overdue, so an old backlog never sets off a flood. */
export function followUpFor(a: { remindedAt?: string; overdueAt?: string }, dueDate: string, today: string): FollowUp {
  const day = (offset: number) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  if (dueDate === day(-1)) return a.overdueAt ? null : "overdue";
  if (dueDate === today || dueDate === day(1)) return a.remindedAt ? null : "remind";
  return null;
}

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Marks and logs what's due now; returns one text per person, listing each of their bills. */
export const claim = internalMutation({
  args: { now: v.string() },
  handler: async (ctx, { now }) => {
    const co = await getCompany(ctx);
    const today = new Date(now).toLocaleDateString("en-CA", { timeZone: co.timeZone });
    const lines: Record<"maya" | "dev", string[]> = { maya: [], dev: [] };
    const pending = await ctx.db
      .query("approvals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    for (const a of pending) {
      const bill = await ctx.db
        .query("bills")
        .withIndex("by_key", (q) => q.eq("key", a.billKey))
        .unique();
      if (!bill || bill.practice || bill.status === "Paid") continue;
      const step = followUpFor(a, bill.dueDate.slice(0, 10), today);
      if (!step) continue;
      const supplier = await ctx.db
        .query("suppliers")
        .withIndex("by_key", (q) => q.eq("key", bill.supplierKey))
        .unique();
      const who = a.routedTo ?? "dev";
      const name = co[who].name;
      const what = `${supplier?.name ?? bill.supplierKey} #${bill.invoiceNo}, ${money(bill.amountCents)}`;
      const log = (doing: string, why: string) =>
        ctx.db.insert("activity", { key: `act_${crypto.randomUUID()}`, actor: "callback", what: doing, why, refKind: "bill", refKey: bill.key, at: now });
      if (step === "remind") {
        const when = bill.dueDate.slice(0, 10) === today ? "today" : "tomorrow";
        await ctx.db.patch(a._id, { remindedAt: now });
        await log(`reminded ${name}: due ${when}`, `${what} is due ${when} and still waiting on ${name}. ${a.recommendation}`);
        lines[who].push(`${what}, due ${when}`);
      } else {
        await ctx.db.patch(a._id, { overdueAt: now });
        await log(`missed the due date without a decision, so paid nothing`, `${what} was due ${bill.dueDate.slice(0, 10)} and ${name} hasn't decided. Nothing was paid; ${co.maya.name} was told, to update ${supplier?.name ?? "the payee"}.`);
        lines[who].push(`${what}, was due yesterday, nothing paid`);
        if (who !== "maya") lines.maya.push(`${what}: ${name} didn't decide by the due date, nothing paid. Let them know.`);
      }
    }
    return (["dev", "maya"] as const)
      .filter((who) => lines[who].length > 0)
      .map((who) => ({
        who,
        name: co[who].name,
        body: `hold: ${lines[who].length === 1 ? "this needs" : `these ${lines[who].length} need`} your decision in Approvals. ${lines[who].join("; ")}.`,
      }));
  },
});

export const logActivity = internalMutation({
  args: { what: v.string(), why: v.string(), at: v.string() },
  handler: (ctx, { what, why, at }) =>
    ctx.db.insert("activity", { key: `act_${crypto.randomUUID()}`, actor: "callback", what, why, refKind: "approvals", refKey: "", at }),
});

// ponytail: US carriers block texts from an unregistered 10DLC number (Twilio error 30034); if
// texts fail, register the number for A2P or use a verified toll-free one.
async function sendText(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) throw new Error("Twilio isn't set up in Convex (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER).");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
}

const PHONE_ENV = { dev: "DEV_PHONE_NUMBER", maya: "MAYA_PHONE_NUMBER" } as const;

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = new Date().toISOString();
    const texts: Array<{ who: "dev" | "maya"; name: string; body: string }> = await ctx.runMutation(internal.app.followUp.claim, { now });
    for (const t of texts) {
      try {
        const to = process.env[PHONE_ENV[t.who]];
        if (!to) throw new Error(`${PHONE_ENV[t.who]} isn't set in Convex.`);
        await sendText(to, t.body);
        await ctx.runMutation(internal.app.followUp.logActivity, { what: `texted ${t.name}`, why: t.body, at: now });
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        await ctx.runMutation(internal.app.followUp.logActivity, { what: `couldn't text ${t.name}`, why: `${why} The reminder is in the Activity log and Approvals instead.`, at: now });
      }
    }
  },
});
