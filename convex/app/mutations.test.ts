// Proves lib/policy.ts is enforced on the server, not just in the UI (plan-agent.md risk #1):
// refusals throw ConvexError carrying the policy's reason string, and every attempt (refused or
// not) is logged to the activity table.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api.js";
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
    expect(await t.mutation(fns.mutations.payBill, { billKey: "bill_4471" })).toEqual({ refused: "Callback can't pay this on its own. Bills of $10,000 or more need your approval." });
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

  test("refuses to move money while Watch only is on", async () => {
    const { t, fns, seed, billRow } = harness();
    await seed({ amountCents: 50_000 });
    await t.mutation(fns.mutations.setWatchOnly, { watchOnly: true, actor: "dev" });
    expect(await t.mutation(fns.mutations.payBill, { billKey: "bill_4471" })).toEqual({
      refused: "Watch only is on. Callback flags and calls but doesn't move money.",
    });
    expect((await billRow()).status).toBe("Checking");
  });

  test("pays normally once Watch only is turned back off", async () => {
    const { t, fns, seed, billRow } = harness();
    await seed({ amountCents: 50_000 });
    await t.mutation(fns.mutations.setWatchOnly, { watchOnly: true, actor: "dev" });
    await t.mutation(fns.mutations.setWatchOnly, { watchOnly: false, actor: "dev" });
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
    expect(await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "callback" as never }),).toEqual({ refused: "Callback can't approve its own requests. It needs your approval." });
  });

  test("refuses Dev releasing a held payment whose bank change wasn't confirmed by call", async () => {
    const h = await seedApproval({ status: "Held", checks: [BANK_FLAG] }, "bank_change");
    expect(await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "dev" })).toEqual({ refused: "Callback can't change bank details without a confirmed call. Call the supplier on the number on file first." });
    expect((await h.billRow()).status).toBe("Held");
  });

  test("Dev approving a bank change after a confirmed call marks that account verified by call + Dev", async () => {
    const h = await seedApproval({ status: "Held", checks: [BANK_FLAG] }, "bank_change");
    await h.t.run(async (ctx) => {
      await ctx.db.insert("callRequests", { call_id: "call_c", bill_id: "bill_4471", supplier_id: "sup_stage", to_number: SUPPLIER.trustedPhone, number_source: "on_file", reason: ["bank-account"], status: "done" });
      await ctx.db.insert("callResults", { call_id: "call_c", outcome: "confirmed", summary: "Confirmed.", evidence: [], recording_url: "" });
    });
    await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "dev" });
    const acct = await h.t.run((ctx) => ctx.db.query("bankAccounts").withIndex("by_key", (q) => q.eq("key", "bank_stage")).unique());
    expect(acct?.verifiedBy).toBe("call+dev");
  });

  test("Dev approves a big payment", async () => {
    const h = await seedApproval({ amountCents: 1_500_000 }, "big_payment");
    await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "dev" });
    expect((await h.billRow()).status).toBe("Scheduled");
  });

  test("refuses Dev's approval while Watch only is on", async () => {
    const h = await seedApproval({ amountCents: 1_500_000 }, "big_payment");
    await h.t.mutation(h.fns.mutations.setWatchOnly, { watchOnly: true, actor: "dev" });
    expect(await h.t.mutation(h.fns.mutations.decideApproval, { billKey: "bill_4471", decision: "approve", actor: "dev" })).toEqual({
      refused: "Watch only is on. Callback flags and calls but doesn't move money.",
    });
    expect((await h.billRow()).status).toBe("Checking");
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

  test("a call already queued for this bill is a no-op: returns the existing call_id, doesn't insert another or log activity", async () => {
    const { t, fns, seed, activity } = harness();
    await seed({ checks: [BANK_FLAG], status: "Calling" });
    await t.run((ctx) =>
      ctx.db.insert("callRequests", {
        call_id: "call_existing",
        bill_id: "bill_4471",
        supplier_id: "sup_stage",
        to_number: SUPPLIER.trustedPhone,
        number_source: "on_file",
        reason: ["Asked to confirm this bill"],
        status: "dialing",
        attempt: 0,
        mode: "live",
      }),
    );
    const before = (await activity()).length;
    const call_id = await t.mutation(fns.mutations.requestCall, { billKey: "bill_4471" });
    expect(call_id).toBe("call_existing");
    const requests = await t.run((ctx) => ctx.db.query("callRequests").collect());
    expect(requests).toHaveLength(1);
    expect((await activity()).length).toBe(before);
  });

  test("refuses to call a supplier with no trusted phone on file", async () => {
    const { t, fns, seed } = harness();
    await seed({ checks: [BANK_FLAG] });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("suppliers")
        .withIndex("by_key", (q) => q.eq("key", "sup_stage"))
        .unique();
      await ctx.db.patch(row!._id, { trustedPhone: "" });
    });
    const result = await t.mutation(fns.mutations.requestCall, { billKey: "bill_4471" });
    expect(result).toEqual({ refused: "No number on file yet. Run the background check and confirm a number first." });
    const requests = await t.run((ctx) => ctx.db.query("callRequests").collect());
    expect(requests).toHaveLength(0);
  });
});

describe("claimPayment", () => {
  test("refuses while Watch only is on, so no transfer can go out", async () => {
    const { t, fns, seed } = harness();
    await seed({ status: "Scheduled" });
    await t.mutation(fns.mutations.setWatchOnly, { watchOnly: true, actor: "dev" });
    const claim = await t.mutation(fns.mutations.claimPayment, { billKey: "bill_4471", bankAccountKey: "bank_stage", amountCents: 500_000 });
    expect(claim).toEqual({ refused: "Watch only is on. Callback flags and calls but doesn't move money." });
    expect(await t.run((ctx) => ctx.db.query("payments").collect())).toHaveLength(0);
  });

  test("two sequential claims on the same bill: the second is refused", async () => {
    const { t, fns, seed } = harness();
    await seed({ status: "Scheduled" });
    const first = await t.mutation(fns.mutations.claimPayment, { billKey: "bill_4471", bankAccountKey: "bank_stage", amountCents: 500_000 });
    expect(first).toHaveProperty("paymentKey");
    const second = await t.mutation(fns.mutations.claimPayment, { billKey: "bill_4471", bankAccountKey: "bank_stage", amountCents: 500_000 });
    expect(second).toEqual({ refused: "A payment for bill_4471 is already pending or sent." });
    const payments = await t.run((ctx) => ctx.db.query("payments").collect());
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe("pending");
  });

  test("after failPayment marks the claim failed, a retry can claim again", async () => {
    const { t, fns, seed } = harness();
    await seed({ status: "Scheduled" });
    const first = await t.mutation(fns.mutations.claimPayment, { billKey: "bill_4471", bankAccountKey: "bank_stage", amountCents: 500_000 });
    if (!("paymentKey" in first)) throw new Error("expected a claim");
    await t.mutation(fns.mutations.failPayment, { paymentKey: first.paymentKey });
    const retry = await t.mutation(fns.mutations.claimPayment, { billKey: "bill_4471", bankAccountKey: "bank_stage", amountCents: 500_000 });
    expect(retry).toHaveProperty("paymentKey");
    const bill = await t.run((ctx) => ctx.db.query("bills").collect()).then((rows) => rows[0]!);
    expect(bill.status).toBe("Scheduled");
  });
});

describe("dueBills (the daily payment run's list)", () => {
  test("only real Scheduled bills that are due and not already paid", async () => {
    const { t, fns, seed } = harness();
    await seed({ status: "Scheduled", dueDate: "2026-09-22" });
    await t.run(async (ctx) => {
      await ctx.db.insert("bills", bill({ key: "bill_future", status: "Scheduled", dueDate: "2026-12-01" }));
      await ctx.db.insert("bills", bill({ key: "bill_practice", status: "Scheduled", practice: true }));
      await ctx.db.insert("bills", bill({ key: "bill_held", status: "Held" }));
      await ctx.db.insert("bills", bill({ key: "bill_sent", status: "Scheduled" }));
      await ctx.db.insert("payments", { key: "pay_sent", billKey: "bill_sent", amountCents: 500_000, bankAccountKey: "bank_stage", status: "sent", paidAt: "2026-09-20" });
    });
    expect(await t.query(internal.app.increase.dueBills, { today: "2026-10-24" })).toEqual(["bill_4471"]);
    await t.mutation(fns.mutations.setWatchOnly, { watchOnly: true, actor: "dev" });
    expect(await t.query(internal.app.increase.dueBills, { today: "2026-10-24" })).toEqual([]);
  });
});
