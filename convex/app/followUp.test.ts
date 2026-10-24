// Approval follow-ups: who gets texted about which bill, exactly once, and a rejection carried out.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";
import { followUpFor } from "./followUp.js";

describe("followUpFor", () => {
  test("reminds once when due today or tomorrow, flags overdue once the day after, ignores old backlog", () => {
    expect(followUpFor({}, "2026-10-25", "2026-10-24")).toBe("remind");
    expect(followUpFor({}, "2026-10-24", "2026-10-24")).toBe("remind");
    expect(followUpFor({ remindedAt: "x" }, "2026-10-25", "2026-10-24")).toBeNull();
    expect(followUpFor({ remindedAt: "x" }, "2026-10-23", "2026-10-24")).toBe("overdue");
    expect(followUpFor({ overdueAt: "x" }, "2026-10-23", "2026-10-24")).toBeNull();
    expect(followUpFor({}, "2026-10-01", "2026-10-24")).toBeNull();
    expect(followUpFor({}, "2026-10-30", "2026-10-24")).toBeNull();
  });
});

const NOW = "2026-10-24T19:00:00.000Z"; // noon in San Francisco, Saturday Oct 24

function harness() {
  const t = convexTest(schema, modules);
  const seed = () =>
    t.run(async (ctx) => {
      await ctx.db.insert("suppliers", {
        key: "sup_stage",
        name: "Stagecraft Rigging Co.",
        category: "stage",
        domain: "stagecraftrigging.com",
        contactName: "Rosa Quintero",
        contactEmail: "rosa@stagecraftrigging.com",
        trustedPhone: "+14155550100",
        phoneLastCheckedAt: "2026-09-19",
      });
      await ctx.db.insert("bankAccounts", { key: "bank_stage", supplierKey: "sup_stage", bank: "Chase", last4: "2210", routingLast4: "9527", status: "active", verifiedBy: "onboarding", addedAt: "2025-01-01" });
      for (const [key, dueDate, status] of [
        ["bill_tomorrow", "2026-10-25", "Needs you"],
        ["bill_yesterday", "2026-10-23", "Needs you"],
        ["bill_old", "2026-09-01", "Held"],
        ["bill_paid", "2026-10-25", "Paid"],
      ] as const) {
        await ctx.db.insert("emails", { key: `email_${key}`, billKey: key, fromAddress: "rosa@stagecraftrigging.com", fromDomain: "stagecraftrigging.com", subject: "Invoice", body: "Invoice attached.", receivedAt: "2026-10-01T16:00:00.000Z", direction: "in" });
        await ctx.db.insert("bills", { key, supplierKey: "sup_stage", invoiceNo: key, amountCents: 1_840_000, currency: "USD", dueDate, receivedAt: "2026-10-01T16:00:00.000Z", bankAccountKey: "bank_stage", status, emailKey: `email_${key}`, planted: false, checks: [] });
        await ctx.db.insert("approvals", { key: `appr_${key}`, billKey: key, kind: "big_payment", status: "pending", recommendation: "Pay Chase ··2210.", routedTo: "dev", thread: [] });
      }
    });
  const approval = (billKey: string) => t.run((ctx) => ctx.db.query("approvals").withIndex("by_bill", (q) => q.eq("billKey", billKey)).unique());
  return { t, seed, approval };
}

describe("claim", () => {
  test("texts Dev about the bill due tomorrow and the one missed yesterday, tells Maya about the miss, once", async () => {
    const h = harness();
    await h.seed();
    const texts = await h.t.mutation(internal.app.followUp.claim, { now: NOW });

    expect(texts.map((x) => x.who)).toEqual(["dev", "maya"]);
    expect(texts[0]!.body).toContain("Stagecraft Rigging Co. #bill_tomorrow, $18,400.00, due tomorrow");
    expect(texts[0]!.body).toContain("#bill_yesterday, $18,400.00, was due yesterday, nothing paid");
    expect(texts[0]!.body).not.toContain("bill_old");
    expect(texts[0]!.body).not.toContain("bill_paid");
    expect(texts[1]!.body).toContain("Dev didn't decide by the due date");

    expect((await h.approval("bill_tomorrow"))!.remindedAt).toBe(NOW);
    expect((await h.approval("bill_yesterday"))!.overdueAt).toBe(NOW);
    expect(await h.t.mutation(internal.app.followUp.claim, { now: NOW })).toEqual([]);
  });
});

describe("Dev's answer is carried out", () => {
  test("a rejected bill is held so no payment run can send it", async () => {
    const h = harness();
    await h.seed();
    await h.t.mutation(api.app.mutations.decideApproval, { billKey: "bill_tomorrow", decision: "reject", actor: "dev" });
    const bill = await h.t.run((ctx) => ctx.db.query("bills").withIndex("by_key", (q) => q.eq("key", "bill_tomorrow")).unique());
    expect(bill!.status).toBe("Held");
    const log = await h.t.run((ctx) => ctx.db.query("activity").collect());
    expect(log.map((a) => a.what)).toContain("held this bill after it was rejected");
  });
});
