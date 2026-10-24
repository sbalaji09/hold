// End to end through the voice entry points the voice server really calls (finishCall,
// reportNoAnswer, takeover) and Convex's scheduler, down to the bill, its approval and the log.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CallResult } from "../../shared/contract.js";
import { api } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

const SECRET = "test-secret-0123456789";

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
  key: "bank_new",
  supplierKey: "sup_stage",
  bank: "Mercury",
  last4: "8817",
  routingLast4: "0001",
  status: "active" as const,
  verifiedBy: "onboarding" as const,
  addedAt: "2026-10-23",
};
const EMAIL = {
  key: "email_in_1",
  billKey: "bill_in_1",
  fromAddress: "rosa@stagecraftrigging.com",
  fromDomain: "stagecraftrigging.com",
  subject: "Invoice #4502, new bank details",
  body: "We moved banks, please pay the new account.",
  receivedAt: "2026-10-23T16:00:00.000Z",
  direction: "in" as const,
};
const BANK_FLAG = {
  id: "bank-account",
  label: "Bank account",
  state: "flag" as const,
  evidence: "Bank account never used before.",
  cite: { kind: "email" as const, ref: "email_in_1" },
};
const RUSH_FLAG = { ...BANK_FLAG, id: "rush", label: "Rush language", evidence: "Asks to pay today." };

const DENIAL = {
  outcome: "not_confirmed" as const,
  evidence: [{ ask: "Did you recently change your bank account?", answer: "No, we never changed our bank.", matches: false }],
  summary: "Supplier says they never changed their bank details.",
  clip: { start_s: 41, end_s: 47 },
};

function harness() {
  const t = convexTest(schema, modules);
  const seed = async (bill: Record<string, unknown> = {}) => {
    await t.run(async (ctx) => {
      await ctx.db.insert("suppliers", SUPPLIER);
      await ctx.db.insert("bankAccounts", BANK);
      await ctx.db.insert("emails", EMAIL);
      await ctx.db.insert("bills", {
        key: "bill_in_1",
        supplierKey: "sup_stage",
        invoiceNo: "4502",
        amountCents: 1_840_000,
        currency: "USD",
        dueDate: "2026-10-30",
        receivedAt: "2026-10-23T16:00:00.000Z",
        bankAccountKey: "bank_new",
        status: "Calling",
        emailKey: "email_in_1",
        planted: false,
        checks: [BANK_FLAG],
        ...bill,
      });
    });
    await addCall("call_1");
  };
  const addCall = (call_id: string, bill_id = "bill_in_1") =>
    t.run((ctx) =>
      ctx.db.insert("callRequests", {
        call_id,
        bill_id,
        supplier_id: "sup_stage",
        to_number: "+14155550100",
        number_source: "on_file",
        reason: ["Bank account"],
        status: "queued",
        mode: "live",
        attempt: 0,
      }),
    );
  const finish = async (call_id: string, result: Omit<CallResult, "call_id">) => {
    await t.mutation(api.voice.server.finishCall, { secret: SECRET, result: { call_id, ...result } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  const bill = () => t.run((ctx) => ctx.db.query("bills").first());
  const approvals = () => t.run((ctx) => ctx.db.query("approvals").collect());
  const activity = () => t.run((ctx) => ctx.db.query("activity").collect());
  return { t, seed, addCall, finish, bill, approvals, activity };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOICE_SERVER_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("a check call's result moves its bill", () => {
  test('"We never changed our bank": Held, with a pending approval for Dev and a log entry', async () => {
    const h = harness();
    await h.seed();
    await h.finish("call_1", DENIAL);

    expect((await h.bill())!.status).toBe("Held");
    const [approval] = await h.approvals();
    expect(approval).toMatchObject({ billKey: "bill_in_1", kind: "bank_change", status: "pending", routedTo: "dev" });
    expect(approval!.reason).toContain("never changed their bank details");
    expect((await h.activity()).map((a) => a.what)).toEqual([
      "held this bill after the check call",
      "proposed a rule for Stagecraft Rigging Co.",
    ]);
    const rules = await h.t.run((ctx) => ctx.db.query("learnedRules").collect());
    expect(rules).toMatchObject([{ status: "proposed", kind: "never_changed_bank" }]);
  });

  test("a supplier that already has an active never-changed-bank rule doesn't get a duplicate proposal", async () => {
    const h = harness();
    await h.seed();
    await h.t.run((ctx) =>
      ctx.db.insert("learnedRules", {
        key: "rule_existing",
        supplierKey: "sup_stage",
        text: "Stagecraft Rigging Co. says they've never changed their bank account.",
        createdBy: "dev",
        sourceKind: "call",
        sourceKey: "call_old",
        createdAt: "2026-10-01T00:00:00.000Z",
        kind: "never_changed_bank",
        status: "active",
      }),
    );
    await h.finish("call_1", DENIAL);
    const rules = await h.t.run((ctx) => ctx.db.query("learnedRules").collect());
    expect(rules).toHaveLength(1);
  });

  test("a scam the call caught is kept as a test case for future playbook changes", async () => {
    const h = harness();
    await h.seed();
    await h.finish("call_1", DENIAL);
    const scams = await h.t.run((ctx) => ctx.db.query("practiceScams").collect());
    expect(scams).toMatchObject([{ billKey: "bill_in_1", kind: "caught by check call" }]);
  });

  test("a practice bill's caught scam isn't added again", async () => {
    const h = harness();
    await h.seed({ practice: true });
    await h.finish("call_1", DENIAL);
    expect(await h.t.run((ctx) => ctx.db.query("practiceScams").collect())).toHaveLength(0);
  });

  test("no answer twice: Needs you, routed to you with the reason", async () => {
    const h = harness();
    await h.seed();
    for (let i = 0; i < 2; i++) {
      await h.t.mutation(api.voice.server.claimRequest, { secret: SECRET, call_id: "call_1" });
      await h.t.mutation(api.voice.server.reportNoAnswer, { secret: SECRET, call_id: "call_1" });
      await h.t.finishAllScheduledFunctions(vi.runAllTimers); // the retry requeue, then the bill
    }
    expect((await h.bill())!.status).toBe("Needs you");
    expect((await h.approvals())[0]).toMatchObject({ routedTo: "dev", status: "pending" });
  });

  test("taking over before the call connects: Needs you", async () => {
    const h = harness();
    await h.seed();
    await h.t.mutation(api.voice.ui.requestTakeover, { call_id: "call_1" });
    await h.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await h.bill())!.status).toBe("Needs you");
  });

  test("a confirmed bank change goes to Dev, never straight to payment", async () => {
    const h = harness();
    await h.seed({ amountCents: 50_000 });
    await h.finish("call_1", { outcome: "confirmed", evidence: [], summary: "Supplier answered every question in line with our records and confirmed the bank change." });
    expect((await h.bill())!.status).toBe("Needs you");
    expect((await h.approvals())[0]).toMatchObject({ kind: "bank_change", routedTo: "dev" });
  });

  test("a confirmed bill under $10,000 with no bank change is scheduled", async () => {
    const h = harness();
    await h.seed({ amountCents: 50_000, checks: [RUSH_FLAG] });
    await h.finish("call_1", { outcome: "confirmed", evidence: [], summary: "Supplier answered every question in line with our records." });
    expect((await h.bill())!.status).toBe("Scheduled");
    expect(await h.approvals()).toHaveLength(0);
  });

  test("a bill a person already moved keeps its status; the call is still logged", async () => {
    const h = harness();
    await h.seed({ status: "Paid" });
    await h.finish("call_1", DENIAL);
    expect((await h.bill())!.status).toBe("Paid");
    expect(await h.approvals()).toHaveLength(0);
    expect((await h.activity())[0]!.why).toContain("already Paid");
  });

  test("a late result from an earlier call can't move the bill", async () => {
    const h = harness();
    await h.seed();
    await h.addCall("call_2"); // called again; call_1's result arrives afterwards
    await h.finish("call_1", DENIAL);
    expect((await h.bill())!.status).toBe("Calling");
    expect((await h.activity())[0]!.why).toContain("A newer check call on this bill decides it");
  });

  test("results with no bill behind them (incoming-line follow-ups) change nothing", async () => {
    const h = harness();
    await h.seed();
    await h.addCall("call_fu_in_CA1", "inbound:in_CA1");
    await h.finish("call_fu_in_CA1", DENIAL);
    expect((await h.bill())!.status).toBe("Calling");
    expect(await h.activity()).toHaveLength(0);
  });

  test("the result is saved once and the bill moves once, even if finishCall is retried", async () => {
    const h = harness();
    await h.seed();
    await h.finish("call_1", DENIAL);
    await h.finish("call_1", { outcome: "confirmed", evidence: [], summary: "retry with a different result" });
    expect((await h.bill())!.status).toBe("Held");
    expect(await h.approvals()).toHaveLength(1);
    expect(await h.activity()).toHaveLength(2);
  });
});

describe("an answer left for review", () => {
  const ASK = { ask: "Can you confirm the total on your September invoice, number 4471?", answer: "About eighteen thousand, I think." };
  const REVIEW = {
    outcome: "needs_review" as const,
    evidence: [
      { ...ASK, source: { kind: "invoice" as const, ref: "#4471" }, matches: false, ask_id: "call_1:ask:1", pending_review: true },
      { ask: "Did you recently change your bank account?", answer: "Yes, last week.", matches: true },
    ],
    summary: "Waiting on your review.",
  };

  async function reviewed(verdict: "matches" | "no_match") {
    const h = harness();
    await h.seed();
    await h.t.run(async (ctx) => {
      await ctx.db.insert("callEvents", { call_id: "call_1", type: "ask_person", ask_id: "call_1:ask:1", ...ASK, expected: "$18,400.00", source: { kind: "invoice", ref: "#4471" }, follow_up_allowed: true });
      await ctx.db.insert("callEvents", { call_id: "call_1", type: "person_answer", ask_id: "call_1:ask:1", verdict: "deferred" });
    });
    await h.finish("call_1", REVIEW);
    expect((await h.bill())!.status).toBe("Needs you");
    expect(await h.approvals()).toEqual([]); // the review box is the action, not an approval
    await h.t.mutation(api.voice.ui.answerAsk, { call_id: "call_1", ask_id: "call_1:ask:1", verdict, actor: "dev" });
    await h.t.finishAllScheduledFunctions(vi.runAllTimers);
    return h;
  }

  test("Matches moves the bill on as a confirmed call (a bank change still needs approval)", async () => {
    const h = await reviewed("matches");
    expect(await h.approvals()).toMatchObject([{ kind: "bank_change", status: "pending" }]);
    expect((await h.bill())!.status).toBe("Needs you");
  });

  test("Doesn't match holds the bill", async () => {
    const h = await reviewed("no_match");
    expect((await h.bill())!.status).toBe("Held");
    expect(await h.approvals()).toMatchObject([{ status: "pending" }]);
  });
});
