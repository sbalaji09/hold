// Proves lib/policy.ts is enforced on the server, not just in the UI (plan-agent.md risk #1):
// refusals throw ConvexError carrying the policy's reason string, and every attempt (refused or
// not) is logged to the activity table.
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

const BANK_OLD = {
  key: "bank_stage_old",
  supplierKey: "sup_stage",
  bank: "Chase",
  last4: "9981",
  routingLast4: "1122",
  status: "active" as const,
  verifiedBy: "onboarding" as const,
  addedAt: "2024-01-01",
};

const BANK_OTHER_SUPPLIER = {
  key: "bank_other",
  supplierKey: "sup_other",
  bank: "Wells Fargo",
  last4: "4455",
  routingLast4: "6677",
  status: "active" as const,
  verifiedBy: "onboarding" as const,
  addedAt: "2024-01-01",
};

const SUPPLIER_OTHER = { ...SUPPLIER, key: "sup_other", name: "Other Supplier Co." };

const EMAIL = {
  key: "email_4471",
  billKey: "bill_4471",
  fromAddress: "scammer@evil.example",
  fromDomain: "evil.example",
  subject: "Invoice #4471 — new bank details, call us on +19995550000",
  body: "Please pay to our new account. Call us back on +19995550000 if needed.",
  receivedAt: "2026-09-01T16:00:00.000Z",
  direction: "in" as const,
};

const PASS_CHECK = { id: "domain", label: "Domain check", state: "pass" as const, evidence: "Domain matches.", cite: { kind: "email" as const, ref: "email_4471" } };
const BANK_FLAG = {
  id: "bank-account",
  label: "Bank account",
  state: "flag" as const,
  evidence: "New account never used before.",
  cite: { kind: "email" as const, ref: "email_4471" },
};

function bill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: "bill_4471",
    supplierKey: "sup_stage",
    invoiceNo: "4471",
    amountCents: 500_000,
    currency: "USD" as const,
    dueDate: "2026-09-22",
    receivedAt: "2026-09-01T16:00:00.000Z",
    bankAccountKey: "bank_stage",
    status: "Checking" as const,
    emailKey: "email_4471",
    planted: true,
    checks: [PASS_CHECK],
    ...overrides,
  };
}

type AppApi = { app: { mutations: Record<string, any>; queries: Record<string, any> } };
// api is Convex's anyApi proxy; convex/_generated/api.d.ts hasn't been regenerated for this new
// `app` module, so this cast documents the shape test code relies on (never user input).
const appApi = api as unknown as AppApi;

function harness() {
  const t = convexTest(schema, modules);
  const fns = appApi.app;
  const seed = async (billOverrides: Partial<Record<string, unknown>> = {}) => {
    await t.run(async (ctx) => {
      await ctx.db.insert("suppliers", SUPPLIER);
      await ctx.db.insert("bankAccounts", BANK);
      await ctx.db.insert("emails", EMAIL);
      await ctx.db.insert("bills", bill(billOverrides));
    });
  };
  const activity = () => t.run((ctx) => ctx.db.query("activity").collect());
  const billRow = () => t.run((ctx) => ctx.db.query("bills").collect()).then((rows) => rows[0]!);
  return { t, fns, seed, activity, billRow };
}

describe("payBill", () => {
  test("refuses a bill at or over $10,000", async () => {
    const { t, fns, seed, activity, billRow } = harness();
    await seed({ amountCents: 1_500_000 });
    expect(await t.mutation(fns.mutations.payBill, { billKey: "bill_4471" })).toEqual({ refused: "Callback can't pay this on its own. Bills of $10,000 or more need Dev's approval." });
    expect((await billRow()).status).toBe("Checking");
    expect(await activity()).toHaveLength(1);
  });

  test("refuses a flagged bill even under $10,000", async () => {
    const { t, fns, seed } = harness();
    await seed({ amountCents: 50_000, checks: [BANK_FLAG] });
    expect(await t.mutation(fns.mutations.payBill, { billKey: "bill_4471" })).toEqual({ refused: "Callback can't pay this bill. Bank account didn't check out." });
  });

  test("pays a safe bill under $10,000", async () => {
    const { t, fns, seed, billRow } = harness();
    await seed({ amountCents: 50_000 });
    await t.mutation(fns.mutations.payBill, { billKey: "bill_4471" });
    expect((await billRow()).status).toBe("Scheduled");
  });
});

describe("decideApproval", () => {
  async function seedApproval(billOverrides: Partial<Record<string, unknown>>, kind: "big_payment" | "held_payment" | "bank_change") {
    const h = harness();
    await h.seed(billOverrides);
    await h.t.run((ctx) =>
      ctx.db.insert("approvals", {
        key: "appr_bill_4471",
        billKey: "bill_4471",
        kind,
        status: "pending",
        recommendation: "Pay $15,000 to Chase ··2210; everything checked out except the limit.",
        thread: [],
      }),
    );
    return h;
  }

  test("refuses Callback approving its own request (self-approval)", async () => {
    const h = await seedApproval({ amountCents: 1_500_000 }, "big_payment");
    expect(await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "callback" as never }),).toEqual({ refused: "Callback can't approve its own requests. Maya or Dev has to sign off." });
  });

  test("refuses Maya approving", async () => {
    const h = await seedApproval({ amountCents: 1_500_000 }, "big_payment");
    expect(await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "maya" })).toEqual({ refused: "Maya can't approve this. Dev has to sign off." });
  });

  test("refuses Dev releasing a held payment whose bank change wasn't confirmed by call", async () => {
    const h = await seedApproval({ status: "Held", checks: [BANK_FLAG] }, "bank_change");
    expect(await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "dev" })).toEqual({ refused: "Callback can't change bank details without a confirmed call. Call the supplier on the number on file first." });
    expect((await h.billRow()).status).toBe("Held");
  });

  test("Dev approves a big payment", async () => {
    const h = await seedApproval({ amountCents: 1_500_000 }, "big_payment");
    await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "dev" });
    expect((await h.billRow()).status).toBe("Scheduled");
  });

  describe("payToBankAccountKey (demo: pay the old verified account instead)", () => {
    async function seedHeldWithCall() {
      const h = await seedApproval({ status: "Held", checks: [BANK_FLAG] }, "bank_change");
      await h.t.run(async (ctx) => {
        await ctx.db.insert("bankAccounts", BANK_OLD);
        await ctx.db.insert("bankAccounts", BANK_OTHER_SUPPLIER);
        await ctx.db.insert("suppliers", SUPPLIER_OTHER);
        await ctx.db.insert("callRequests", {
          call_id: "call_4471",
          bill_id: "bill_4471",
          supplier_id: "sup_stage",
          to_number: SUPPLIER.trustedPhone,
          number_source: "on_file",
          reason: ["bank-account"],
          status: "done",
        });
        await ctx.db.insert("callResults", {
          call_id: "call_4471",
          outcome: "not_confirmed",
          summary: "Supplier could not confirm the new bank details on the call.",
          evidence: [],
          recording_url: "",
        });
      });
      return h;
    }

    test("Dev approves paying the old verified account after a not_confirmed call: bill schedules on the old account", async () => {
      const h = await seedHeldWithCall();
      await h.t.mutation(h.fns.mutations.decideApproval, {
        billKey: "bill_4471",
        decision: "approve",
        actor: "dev",
        payToBankAccountKey: "bank_stage_old",
      });
      const row = await h.billRow();
      expect(row.status).toBe("Scheduled");
      expect(row.bankAccountKey).toBe("bank_stage_old");
      const entries = await h.activity();
      expect(entries.some((e) => e.what === "approved paying the verified account")).toBe(true);
    });

    test("refuses a bank account belonging to a different supplier", async () => {
      const h = await seedHeldWithCall();
      expect(await h.t.mutation(h.fns.mutations.decideApproval, {
          billKey: "bill_4471",
          decision: "approve",
          actor: "dev",
          payToBankAccountKey: "bank_other",
        }),).toEqual({ refused: "That bank account isn't on file for this supplier." });
      expect((await h.billRow()).status).toBe("Held");
    });

    test("refuses approving the new unverified account via payToBankAccountKey without a confirmed call", async () => {
      const h = await seedApproval({ status: "Held", checks: [BANK_FLAG] }, "bank_change");
      expect(await h.t.mutation(h.fns.mutations.decideApproval, {
          billKey: "bill_4471",
          decision: "approve",
          actor: "dev",
          payToBankAccountKey: "bank_stage",
        }),).toEqual({ refused: "That's the account already on this bill, not the verified alternative." });
      expect((await h.billRow()).status).toBe("Held");
    });
  });
});

describe("requestCall", () => {
  test("dials the supplier's trusted phone, never a number from the email", async () => {
    const { t, fns, seed } = harness();
    await seed({ checks: [BANK_FLAG] });
    await t.mutation(fns.mutations.requestCall, { billKey: "bill_4471" });
    const requests = await t.run((ctx) => ctx.db.query("callRequests").collect());
    expect(requests).toHaveLength(1);
    expect(requests[0]!.to_number).toBe(SUPPLIER.trustedPhone);
    expect(requests[0]!.to_number).not.toBe("+19995550000");
    expect(requests[0]!.number_source).toBe("on_file");
    expect(requests[0]!.status).toBe("queued");
  });
});
