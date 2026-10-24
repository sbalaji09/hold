// The self-improvement loop end to end (Discover -> Propose -> Replay -> Promote), through the real
// entry points, with Claude replaced by a scripted fake: a technique "matches" an email when every
// one of its signals appears in it.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

const fake = vi.hoisted(() => ({ proposals: [] as unknown[], assessCalls: 0 }));

vi.mock("./techniques.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./techniques.js")>();
  const client = {
    messages: {
      parse: async (req: { system: string; messages: { content: string }[] }) => {
        if (req.system.includes("You maintain hold's playbook")) {
          return { stop_reason: "end_turn", parsed_output: fake.proposals.shift() };
        }
        fake.assessCalls++;
        const content = req.messages[0]!.content;
        const body = (/<email[^>]*>\n([\s\S]*)\n<\/email>/.exec(content)?.[1] ?? "").toLowerCase();
        const matches = [...content.matchAll(/<technique key="([^"]+)"[^>]*>[\s\S]*?Signals: ([^\n<]*)/g)]
          .filter(([, , signals]) => signals!.split("; ").every((s) => body.includes(s.toLowerCase())))
          .map(([, techniqueKey]) => ({ techniqueKey: techniqueKey!, quote: "", why: "Signals present" }));
        return { stop_reason: "end_turn", parsed_output: { matches, novel: { suspicious: false, name: "", quote: "", why: "" } } };
      },
    },
  };
  return { ...real, anthropic: () => client };
});

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
const BANK = { key: "bank_stage", supplierKey: "sup_stage", bank: "Chase", last4: "2210", routingLast4: "9527", status: "active" as const, verifiedBy: "onboarding" as const, addedAt: "2025-01-01" };

const PORTAL_SCAM = "Hi team, invoice 4502 is ready. Please pay it through our secure payment portal at pay-stagecraft.com this cycle. Thanks, Rosa";
const ROUTINE = (n: number) => `Hi team, attached is invoice ${n} for rigging labor. Kindly remit to the account on file. Thanks, Rosa`;

function proposal(signals: string[], over: Record<string, unknown> = {}) {
  return { action: "add", targetKey: "", name: "Payment link or portal", howItWorks: "Moves payment to a new web portal.", signals, example: "Please pay through our secure payment portal.", rationale: "The email moved payment to a web portal.", ...over };
}

async function seed(t: ReturnType<typeof convexTest>, trigger: { body: string; status?: string; checks?: unknown[] }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("suppliers", SUPPLIER);
    await ctx.db.insert("bankAccounts", BANK);
    const bill = async (key: string, body: string, status: string, extra: Record<string, unknown> = {}) => {
      await ctx.db.insert("emails", { key: `email_${key}`, billKey: key, fromAddress: "rosa@stagecraftrigging.com", fromDomain: "stagecraftrigging.com", subject: "Invoice", body, receivedAt: `2026-0${key.length % 9}-01T00:00:00.000Z`, direction: "in" });
      await ctx.db.insert("bills", { key, supplierKey: "sup_stage", invoiceNo: key, amountCents: 500_000, currency: "USD", dueDate: "2026-10-30", receivedAt: "2026-09-01T00:00:00.000Z", bankAccountKey: "bank_stage", status: status as "Paid", emailKey: `email_${key}`, planted: false, ...extra });
    };
    for (const n of [4101, 4102, 4103]) await bill(`bill_${n}`, ROUTINE(n), "Paid");
    // A Practice scam the regex checks already catch (bank change).
    await bill("bill_scam", "Hi team, we moved banks. Please pay invoice 4400 to our new account.", "Held", { planted: true });
    await ctx.db.insert("practiceScams", { key: "scam_1", billKey: "bill_scam", kind: "bank change", description: "bank change", checksThatShouldFire: ["New bank account"] });
    await bill("bill_trigger", trigger.body, trigger.status ?? "Scheduled", trigger.checks ? { checks: trigger.checks } : {});
  });
}

const improvements = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("improvements").collect());
const techniques = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("fraudTechniques").collect());
const activity = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("activity").collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOICE_SERVER_SECRET", SECRET);
  fake.proposals = [];
  fake.assessCalls = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("hold learns from a scam it missed", () => {
  test("a fix that catches the scam and breaks nothing goes live at once", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { body: PORTAL_SCAM });
    fake.proposals = [proposal(["payment portal"])];

    await t.mutation(api.app.techniques.reportMissedScam, { billKey: "bill_trigger", actor: "dev" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [impr] = await improvements(t);
    expect(impr).toMatchObject({ status: "promoted", replay: { attempts: 1, fixed: true, regressions: 0 } });
    expect(impr!.replay!.cases.find((c: { billKey?: string }) => c.billKey === "bill_trigger")).toMatchObject({ expected: "flag", before: "pass", after: "flag" });
    expect(impr!.summary).toContain("Replayed on 4 past cases plus the new one: handles the new case, no regressions.");
    const [learned] = await techniques(t);
    expect(learned).toMatchObject({ name: "Payment link or portal", status: "active", sourceKind: "missed_scam", sourceRef: "bill_trigger", improvementKey: impr!.key });
    expect((await activity(t)).map((a) => a.what)).toContain('learned a new fraud technique: "Payment link or portal"');
    // The missed scam joined the regression suite.
    expect(await t.run((ctx) => ctx.db.query("practiceScams").collect())).toHaveLength(2);
  });

  test("a fix that would flag routine bills is revised once, then promoted", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { body: PORTAL_SCAM });
    fake.proposals = [proposal(["invoice"]), proposal(["payment portal"])]; // "invoice" is in every routine bill

    await t.mutation(api.app.techniques.reportMissedScam, { billKey: "bill_trigger", actor: "dev" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [impr] = await improvements(t);
    expect(impr).toMatchObject({ status: "promoted", replay: { attempts: 2, regressions: 0 } });
    expect((await techniques(t))[0]!.signals).toEqual(["payment portal"]);
  });

  test("a change that can't avoid regressions is rejected and the playbook stays as it was", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { body: PORTAL_SCAM });
    fake.proposals = [proposal(["invoice"]), proposal(["invoice"])];

    await t.mutation(api.app.techniques.reportMissedScam, { billKey: "bill_trigger", actor: "dev" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [impr] = await improvements(t);
    expect(impr).toMatchObject({ status: "rejected", replay: { attempts: 2, regressions: 3 } });
    expect(await techniques(t)).toHaveLength(0);
    expect((await activity(t)).map((a) => a.what)).toContain("kept its fraud playbook as it was");
  });

  test("Callback can't report or teach on its own", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { body: PORTAL_SCAM });
    await expect(t.mutation(api.app.techniques.reportMissedScam, { billKey: "bill_trigger", actor: "callback" })).rejects.toThrow("hold can't report a missed scam on its own.");
    await expect(t.mutation(api.app.techniques.teach, { description: "Scammers now ask for payment through a portal link.", actor: "callback" })).rejects.toThrow("hold can't teach itself something on its own.");
  });
});

describe("hold learns from a false alarm, but only Dev can loosen it", () => {
  test("a confirmed call on a flagged bill proposes a narrower technique that waits for Dev, and can be reverted", async () => {
    const t = convexTest(schema, modules);
    const legit = "Hi team, invoice 4502 is ready. You can now also pay through our payment portal, or by transfer as usual. Thanks, Rosa";
    const flagged = { id: "fraud-technique", label: "Fraud technique", state: "flag", evidence: 'Matches "Payment link or portal".', cite: { kind: "email", ref: "rosa@stagecraftrigging.com" } };
    await seed(t, { body: legit, status: "Calling", checks: [flagged] });
    await t.run(async (ctx) => {
      await ctx.db.insert("fraudTechniques", { key: "tech_portal", name: "Payment link or portal", howItWorks: "Moves payment to a portal.", signals: ["payment portal"], example: "", status: "active", sourceKind: "seed", createdAt: "2026-10-01" });
      await ctx.db.insert("callRequests", { call_id: "call_1", bill_id: "bill_trigger", supplier_id: "sup_stage", to_number: "+14155550100", number_source: "on_file", reason: ["Fraud technique"], status: "queued", mode: "live", attempt: 0 });
    });
    fake.proposals = [proposal(["payment portal", "instead of"], { action: "refine", targetKey: "tech_portal", rationale: "A portal offered alongside the usual transfer is not a scam." })];

    await t.mutation(api.voice.server.finishCall, { secret: SECRET, result: { call_id: "call_1", outcome: "confirmed", evidence: [], summary: "Supplier confirmed the portal." } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [impr] = await improvements(t);
    expect(impr).toMatchObject({ status: "needs_approval", trigger: { kind: "false_alarm", billKey: "bill_trigger", by: "callback" } });
    expect((await techniques(t)).filter((r) => r.status === "active").map((r) => r.key)).toEqual(["tech_portal"]); // nothing loosened yet

    await expect(t.mutation(api.app.techniques.decideImprovement, { key: impr!.key, decision: "approve", actor: "callback" })).rejects.toThrow("hold can't approve this on its own.");
    await t.mutation(api.app.techniques.decideImprovement, { key: impr!.key, decision: "approve", actor: "dev" });
    const after = await techniques(t);
    const refined = after.find((r) => r.supersedes === "tech_portal")!;
    expect(refined).toMatchObject({ status: "active", sourceKind: "false_alarm", signals: ["payment portal", "instead of"] });
    expect(after.find((r) => r.key === "tech_portal")!.status).toBe("retired");

    await t.mutation(api.app.techniques.revertTechnique, { techniqueKey: refined.key, actor: "dev" });
    const reverted = await techniques(t);
    expect(reverted.find((r) => r.key === refined.key)!.status).toBe("retired");
    expect(reverted.find((r) => r.key === "tech_portal")!.status).toBe("active");
    expect((await improvements(t))[0]!.status).toBe("reverted");
  });
});

test("hold's own triggers learn from a bill once; a person can always ask again afterwards", async () => {
  const t = convexTest(schema, modules);
  await seed(t, { body: PORTAL_SCAM });
  fake.proposals = [proposal(["payment portal"]), proposal(["payment portal"])];
  await t.mutation(internal.app.techniques.learnFromMisses, { billKeys: ["bill_trigger"] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // Practice missing it again doesn't start another paid run...
  await t.mutation(internal.app.techniques.learnFromMisses, { billKeys: ["bill_trigger"] });
  expect(await improvements(t)).toHaveLength(1);
  // ...but Dev reporting it does.
  await t.mutation(api.app.techniques.reportMissedScam, { billKey: "bill_trigger", actor: "dev" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await improvements(t)).toHaveLength(2);
});
