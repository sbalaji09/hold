// The phone line and the fraud playbook: the post-call screen, its follow-up check call, and
// learning from a reported scam call. Claude is a scripted fake: a tactic "matches" when every one
// of its signals appears in what the caller said.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

const fake = vi.hoisted(() => ({ proposals: [] as unknown[] }));

vi.mock("../app/techniques.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../app/techniques.js")>();
  const client = {
    messages: {
      parse: async (req: { system: string; messages: { content: string }[] }) => {
        if (req.system.includes("You maintain hold's playbook")) return { stop_reason: "end_turn", parsed_output: fake.proposals.shift() };
        const content = req.messages[0]!.content;
        const said = (/<(?:call|email)[^>]*>\n([\s\S]*)\n<\/(?:call|email)>/.exec(content)?.[1] ?? "").toLowerCase();
        const matches = [...content.matchAll(/<technique key="([^"]+)"[^>]*>[\s\S]*?Signals: ([^\n<]*)/g)]
          .filter(([, , signals]) => signals!.split("; ").every((s) => said.includes(s.toLowerCase())))
          .map(([, techniqueKey]) => ({ techniqueKey: techniqueKey!, quote: "call me on my cell instead", why: "Gives a new number to verify on" }));
        return { stop_reason: "end_turn", parsed_output: { matches, novel: { suspicious: false, name: "", quote: "", why: "" } } };
      },
    },
  };
  return { ...real, anthropic: () => client };
});

const SECRET = "test-secret-0123456789";
const STAGE = {
  key: "sup_stage",
  name: "Stagecraft Rigging Co.",
  category: "stage" as const,
  domain: "stagecraftrigging.com",
  contactName: "Rosa Quintero",
  contactEmail: "rosa@stagecraftrigging.com",
  trustedPhone: "+14155550100",
  phoneLastCheckedAt: "2026-09-19",
};
const SWAP = { key: "tech_swap", name: "Callback-number swap", channel: "phone" as const, howItWorks: "New number to verify on.", signals: ["cell instead"], example: "", status: "active" as const, sourceKind: "seed" as const, createdAt: "2026-10-01" };

function record(callerSays: string, over: Record<string, unknown> = {}) {
  return {
    call_id: "in_CA1",
    caller_number: "+16285550143",
    claimed_identity: "Rosa at Stagecraft Rigging",
    claimed_supplier_id: "sup_stage",
    requested: "Wants a call back on her cell",
    asked_bank_change: false,
    transcript: [
      { speaker: "callback" as const, text: "Hi, you've reached Fogline's accounts team.", ts: 0 },
      { speaker: "caller" as const, text: callerSays, ts: 3 },
    ],
    ...over,
  };
}

async function setup(callerSays: string, over: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("suppliers", STAGE);
    await ctx.db.insert("fraudTechniques", SWAP);
  });
  await t.mutation(api.voice.server.finishInboundCall, { secret: SECRET, record: record(callerSays, over) });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const call = await t.run((ctx) => ctx.db.query("inboundCalls").first());
  const requests = await t.run((ctx) => ctx.db.query("callRequests").collect());
  return { t, call: call!, requests };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOICE_SERVER_SECRET", SECRET);
  fake.proposals = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("every finished call is screened against the playbook", () => {
  test("a known phone tactic flags the call and calls the claimed supplier back on the number on file", async () => {
    const { t, call, requests } = await setup("Our phones are down, call me on my cell instead.");
    expect(call.fraud).toMatchObject({ state: "flag", techniqueKeys: ["tech_swap"] });
    expect(call.fraud!.evidence).toContain('Matches "Callback-number swap"');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ to_number: "+14155550100", number_source: "on_file", supplier_id: "sup_stage" });
    expect(requests[0]!.reason[0]).toContain("Suspicious call to the phone line");
    expect(call.triggered_call_id).toBe(requests[0]!.call_id);
    const [log] = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(log).toMatchObject({ what: "flagged a call from +16285550143 as suspicious", refKind: "inboundCall", refKey: "in_CA1" });
  });

  test("an ordinary call passes and nobody is called", async () => {
    const { call, requests } = await setup("Just checking you got our invoice for the truss build.");
    expect(call.fraud).toMatchObject({ state: "pass" });
    expect(call.fraud!.evidence).toContain("phone tactics");
    expect(requests).toHaveLength(0);
  });

  test("a bank-change caller already has a follow-up call; the screen doesn't book a second", async () => {
    const { call, requests } = await setup("We changed banks, and call me on my cell instead.", { asked_bank_change: true });
    expect(call.fraud!.state).toBe("flag");
    expect(requests).toHaveLength(1);
  });

  test("a caller who never spoke isn't judged", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.voice.server.finishInboundCall, { secret: SECRET, record: { ...record(""), transcript: [] } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.query("inboundCalls").first()))!.fraud).toBeUndefined();
  });
});

describe("hold learns phone tactics", () => {
  test("a reported scam call joins the phone Practice set and teaches hold a phone tactic", async () => {
    const { t } = await setup("Please buy two thousand dollars of gift cards and read me the numbers.");
    await t.mutation(internal.app.techniques.seedPlaybook, {});
    fake.proposals = [
      { action: "add", channel: "phone", targetKey: "", name: "Gift card request", howItWorks: "The caller asks for payment in gift cards.", signals: ["gift cards"], example: "Can you pay this one with gift cards?", rationale: "Gift cards are a classic untraceable payment." },
    ];

    await t.mutation(api.app.techniques.reportCall, { callId: "in_CA1", verdict: "scam", actor: "dev" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const impr = (await t.run((ctx) => ctx.db.query("improvements").collect()))[0]!;
    expect(impr).toMatchObject({ status: "promoted", trigger: { kind: "missed_scam", channel: "phone", callId: "in_CA1" } });
    // Replayed against the scripted calls only: a phone tactic can't change how emails are judged.
    expect(impr.replay!.cases.every((c) => !c.billKey)).toBe(true);
    expect(impr.replay!.cases.filter((c) => c.label.startsWith("Practice call:")).length).toBeGreaterThanOrEqual(11);
    const learned = await t.run((ctx) => ctx.db.query("fraudTechniques").withIndex("by_key").collect());
    expect(learned.find((r) => r.name === "Gift card request")).toMatchObject({ channel: "phone", sourceKind: "missed_scam", sourceRef: "in_CA1" });
    const reported = (await t.run((ctx) => ctx.db.query("practiceCalls").collect())).filter((c) => c.source === "reported");
    expect(reported).toMatchObject([{ expected: "flag" }]);
  });

  test("a Practice call judged wrong becomes a lesson once", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("practiceCalls", { key: "pcall_1", kind: "Did you get our invoice", expected: "pass", source: "seed", transcript: "Caller: Did you get our invoice?" }));
    fake.proposals = [{ action: "add", channel: "phone", targetKey: "", name: "x", howItWorks: "x", signals: ["zzz"], example: "zzz", rationale: "x" }];
    await t.mutation(internal.app.techniques.recordCallRun, { results: [{ key: "pcall_1", correct: false }] });
    await t.mutation(internal.app.techniques.recordCallRun, { results: [{ key: "pcall_1", correct: false }] });
    const improvements = await t.run((ctx) => ctx.db.query("improvements").collect());
    expect(improvements).toHaveLength(1);
    expect(improvements[0]!.trigger).toMatchObject({ kind: "false_alarm", channel: "phone", callId: "pcall_1" });
  });

  test("Callback can't report a call on its own", async () => {
    const { t } = await setup("Hello?");
    await expect(t.mutation(api.app.techniques.reportCall, { callId: "in_CA1", verdict: "scam", actor: "callback" })).rejects.toThrow("hold can't");
  });
});
