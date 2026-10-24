// Covers two real intake failure modes: a resent webhook creating a second bill (plan-agent.md
// risk: at-least-once delivery), and an unknown-sender bill breaking hydrateBill (and so
// listBills/listApprovals) because it has no real supplier/bank account row.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

const SUPPLIER = {
  key: "sup_stage",
  name: "Stagecraft Rigging Co.",
  category: "stage" as const,
  domain: "stagecraftrigging.com",
  contactName: "Rosa Quintero",
  contactEmail: "rosa@stagecraftrigging.com",
  trustedPhone: "+14155550100",
  phoneLastCheckedAt: "2026-09-19",
};

const BANK = {
  key: "bank_stage",
  supplierKey: "sup_stage",
  bank: "Chase",
  last4: "2210",
  routingLast4: "9527",
  status: "active" as const,
  verifiedBy: "onboarding" as const,
  addedAt: "2025-01-01",
};

function harness() {
  return { t: convexTest(schema, modules) };
}

describe("ingestEmail dedupe", () => {
  test("a repeat webhook with the same messageId returns the existing bill, no new rows", async () => {
    const { t } = harness();
    await t.run(async (ctx) => {
      await ctx.db.insert("suppliers", SUPPLIER);
      await ctx.db.insert("bankAccounts", BANK);
    });

    const email = {
      from: "Rosa Quintero <rosa@stagecraftrigging.com>",
      subject: "Invoice #4471",
      body: "Please pay invoice #4471 for $900.00.",
      receivedAt: "2026-09-01T16:00:00.000Z",
      messageId: "provider-msg-1",
    };

    const first = await t.action(api.app.intake.ingestEmail, email);
    const second = await t.action(api.app.intake.ingestEmail, email);

    expect(second).toEqual(first);
    const bills = await t.run((ctx) => ctx.db.query("bills").collect());
    const emails = await t.run((ctx) => ctx.db.query("emails").collect());
    expect(bills.length).toBe(1);
    expect(emails.length).toBe(1);
  });

  test("a repeat webhook with no messageId but identical sender/subject/body also dedupes", async () => {
    const { t } = harness();
    await t.run(async (ctx) => {
      await ctx.db.insert("suppliers", SUPPLIER);
      await ctx.db.insert("bankAccounts", BANK);
    });

    const email = {
      from: "Rosa Quintero <rosa@stagecraftrigging.com>",
      subject: "Invoice #4471",
      body: "Please pay invoice #4471 for $900.00.",
      receivedAt: "2026-09-01T16:00:00.000Z",
    };

    const first = await t.action(api.app.intake.ingestEmail, email);
    const second = await t.action(api.app.intake.ingestEmail, { ...email, receivedAt: "2026-09-02T00:00:00.000Z" });

    expect(second).toEqual(first);
    const bills = await t.run((ctx) => ctx.db.query("bills").collect());
    expect(bills.length).toBe(1);
  });
});

describe("unknown sender bills", () => {
  test("listBills and listApprovals hydrate a bill from an unknown sender without throwing", async () => {
    const { t } = harness();

    const result = await t.action(api.app.intake.ingestEmail, {
      from: "Scammer <billing@totally-fake.example>",
      subject: "Invoice #99",
      body: "Please pay invoice #99 for $500.00.",
      receivedAt: "2026-09-03T00:00:00.000Z",
    });
    expect(result.supplierKey).toBe("unknown:totally-fake.example");
    expect(result.status).toBe("Needs you");

    // Also exercise listApprovals' hydrateBill call with the same sentinel bill.
    const billKey = result.billKey;
    await t.run((ctx) =>
      ctx.db.insert("approvals", {
        key: "appr_unknown",
        billKey,
        kind: "big_payment",
        status: "pending",
        recommendation: "test",
        routedTo: "dev",
        reason: "test",
        thread: [],
      }),
    );

    const bills = await t.query(api.app.queries.listBills, {});
    const unknownBill = bills.find((b) => b.key === billKey);
    expect(unknownBill).toBeDefined();
    expect(unknownBill?.supplier.name).toBe("Unknown sender");
    expect(unknownBill?.supplier.domain).toBe("totally-fake.example");
    expect(unknownBill?.bankAccount.bank).toBe("Not on file");

    const approvals = await t.query(api.app.queries.listApprovals, {});
    expect(approvals.some((a) => a.billKey === billKey)).toBe(true);
  });
});
