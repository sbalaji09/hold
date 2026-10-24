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

describe("reviewing an answer after the call", () => {
  const BANK = { ask: "Did you recently change your bank account?", answer: "Yes, last week.", matches: true };

  /** A finished call that left ASK's answer for review; the bank question matched. */
  async function setupReview() {
    const s = await setup("done");
    await s.t.run(async (ctx) => {
      await ctx.db.insert("callEvents", { call_id: "call_1", type: "person_answer", ask_id: ASK.ask_id, verdict: "deferred" });
      await ctx.db.insert("callResults", {
        call_id: "call_1",
        outcome: "needs_review",
        evidence: [{ ask: ASK.ask, source: ASK.source, answer: ASK.answer, matches: false, ask_id: ASK.ask_id, pending_review: true }, BANK],
        summary: "Waiting on your review.",
        recording_url: "",
      });
    });
    const result = () => s.t.run(async (ctx) => (await ctx.db.query("callResults").collect())[0]!);
    const requests = () => s.t.run((ctx) => ctx.db.query("callRequests").collect());
    return { ...s, result, requests };
  }

  test("shows on Today until decided; Matches confirms the call when nothing else waits", async () => {
    const { t, answer, result } = await setupReview();
    expect(await t.query(api.voice.ui.answerReviews, {})).toMatchObject([{ call_id: "call_1", ask_id: ASK.ask_id, answer: ASK.answer, bill_id: "bill_4471" }]);

    await answer({ verdict: "matches" });
    const r = await result();
    expect(r.outcome).toBe("confirmed");
    expect(r.evidence[0]).toMatchObject({ matches: true, decided_by: "dev" });
    expect(r.evidence[0]!.pending_review).toBeUndefined();
    expect(await t.query(api.voice.ui.answerReviews, {})).toEqual([]);
    await expect(answer({ verdict: "no_match" })).rejects.toThrow("already moved on");
  });

  test("Doesn't match makes the call not confirmed", async () => {
    const { answer, result } = await setupReview();
    await answer({ verdict: "no_match" });
    expect((await result()).outcome).toBe("not_confirmed");
  });

  test("a question queues a call back to the same trusted number that asks only it", async () => {
    const { t, answer, result, requests } = await setupReview();
    await answer({ verdict: "follow_up", follow_up: "What was that invoice for?" });
    const back = (await requests()).find((r) => r.call_id !== "call_1")!;
    expect(back).toMatchObject({
      bill_id: "bill_4471",
      to_number: "+14155550100",
      number_source: "on_file",
      status: "queued",
      follow_up: { ask: "What was that invoice for?", source: ASK.source, carried: [BANK] },
    });
    expect((await result()).outcome).toBe("needs_review"); // the call back decides it now
    expect(await t.query(api.voice.ui.answerReviews, {})).toEqual([]);
  });
});
