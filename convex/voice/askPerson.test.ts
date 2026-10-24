// hold's mid-call question for a person (voice/src/call/outbound.ts checkWithPerson): the Live
// call screen's answerAsk and the voice server's closeAsk. The first reply wins either way.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

const SECRET = "test-secret";
const ASK = {
  call_id: "call_1",
  type: "ask_person" as const,
  ask_id: "call_1:ask:1",
  ask: "Can you confirm the total on your September invoice, number 4471?",
  answer: "About eighteen thousand, I think.",
  expected: "$18,400.00",
  source: { kind: "invoice", ref: "#4471", record_id: "bill_4471" },
  follow_up_allowed: true,
};

async function setup(status: "in_progress" | "done" = "in_progress") {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("callRequests", {
      call_id: "call_1",
      bill_id: "bill_4471",
      supplier_id: "sup_stage",
      to_number: "+14155550100",
      number_source: "on_file",
      reason: ["Bank account"],
      status,
    });
    await ctx.db.insert("callEvents", ASK);
  });
  const answer = (args: { verdict: "matches" | "no_match" | "follow_up"; follow_up?: string; ask_id?: string }) =>
    t.mutation(api.voice.ui.answerAsk, { call_id: "call_1", ask_id: ASK.ask_id, actor: "dev", ...args });
  const replies = () => t.run(async (ctx) => (await ctx.db.query("callEvents").collect()).filter((e) => e.type === "person_answer"));
  return { t, answer, replies };
}

beforeEach(() => vi.stubEnv("VOICE_SERVER_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

describe("answerAsk", () => {
  test("records the approver's verdict for voice and logs it on the bill", async () => {
    const { t, answer, replies } = await setup();
    await answer({ verdict: "matches" });
    expect(await replies()).toMatchObject([{ ask_id: ASK.ask_id, verdict: "matches", by: "dev" }]);
    const [log] = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(log).toMatchObject({ actor: "dev", refKind: "bill", refKey: "bill_4471" });
    expect(log!.why).toContain("matches the records (#4471)");
    expect(await t.query(api.voice.server.personAnswer, { secret: SECRET, call_id: "call_1", ask_id: ASK.ask_id })).toMatchObject({ verdict: "matches" });
  });

  test("the first reply wins: a second click, or one after hold stopped waiting, is refused", async () => {
    const { t, answer } = await setup();
    await answer({ verdict: "no_match" });
    await expect(answer({ verdict: "matches" })).rejects.toThrow("already moved on");

    const late = await setup();
    expect(await late.t.mutation(api.voice.server.closeAsk, { secret: SECRET, call_id: "call_1", ask_id: ASK.ask_id })).toBeNull();
    await expect(late.answer({ verdict: "matches" })).rejects.toThrow("already moved on");
    // closeAsk hands back a reply that landed first instead of overwriting it.
    expect(await t.mutation(api.voice.server.closeAsk, { secret: SECRET, call_id: "call_1", ask_id: ASK.ask_id })).toMatchObject({ verdict: "no_match" });
  });

  test("a follow-up must be one short question that never asks about bank details", async () => {
    const { answer, replies } = await setup();
    await expect(answer({ verdict: "follow_up", follow_up: "  " })).rejects.toThrow("Write the question");
    await expect(answer({ verdict: "follow_up", follow_up: "What account number do you use?" })).rejects.toThrow("bank or account");
    await answer({ verdict: "follow_up", follow_up: " What was that invoice for? " });
    expect(await replies()).toMatchObject([{ verdict: "follow_up", follow_up: "What was that invoice for?" }]);
  });

  test("refuses a question hold never asked, or one on a call that's over", async () => {
    const { answer } = await setup();
    await expect(answer({ verdict: "matches", ask_id: "call_1:ask:9" })).rejects.toThrow("didn't ask that");
    const over = await setup("done");
    await expect(over.answer({ verdict: "matches" })).rejects.toThrow("already moved on");
  });
});
