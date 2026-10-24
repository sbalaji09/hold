// The same VoiceStore scenarios run against the real Convex functions (via convex-test) and the
// in-memory fake, so the fake other tests rely on cannot drift from production behaviour.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CallEvent, CallRequest, CallResult, SupplierProfile } from "../../shared/contract.js";
import { MemoryStore } from "../../voice/src/store/memoryStore.js";
import type { VoiceStore } from "../../voice/src/store/types.js";
import fogline from "../../data/fogline.json";
import { api, internal } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";
import { formatRetryAt, followUpCallId } from "./rules.js";
import { toCallRequest, toCallResult } from "./server.js";

const SECRET = "test-secret";
const RETRY_MS = 120_000;

const STAGE: SupplierProfile = {
  supplier_id: "sup_stage",
  name: "Stagecraft Rigging Co.",
  phone_on_file: "+14155550100",
  aliases: ["Stagecraft Rigging", "Stagecraft"],
};
const STAGE_ROW = {
  key: "sup_stage",
  name: "Stagecraft Rigging Co.",
  category: "stage" as const,
  domain: "stagecraftrigging.com",
  contactName: "Rosa Quintero",
  contactEmail: "rosa@stagecraftrigging.com",
  trustedPhone: "+14155550100",
  phoneLastCheckedAt: "2026-09-19",
};

const baseRequest = {
  call_id: "call_1",
  bill_id: "bill_4471",
  supplier_id: "sup_stage",
  to_number: "+14155550100",
  number_source: "on_file" as const,
  reason: ["new bank account"],
};

interface Harness {
  store: VoiceStore;
  addRequest(req: typeof baseRequest): Promise<void>;
  /** Adds Stagecraft (STAGE). */
  addSupplier(): Promise<void>;
  takeover(call_id: string): Promise<void>;
  /** Advance time past the retry and run what was scheduled. */
  runRetry(): Promise<void>;
  results(call_id: string): Promise<CallResult[]>;
  events(call_id: string): Promise<CallEvent[]>;
  request(call_id: string): Promise<(CallRequest & { retry_at_ms?: number }) | null>;
  inboundRecordingUrl(call_id: string): Promise<string | undefined>;
}

function convexHarness(): Harness {
  const t = convexTest(schema, modules);
  const s = SECRET;
  const fns = api.voice.server;
  const store: VoiceStore = {
    watchQueuedRequests: () => {
      throw new Error("not used");
    },
    watchTakeover: () => {
      throw new Error("not used");
    },
    claimRequest: (call_id) => t.mutation(fns.claimRequest, { secret: s, call_id }),
    getRequest: (call_id) => t.query(fns.getRequest, { secret: s, call_id }),
    setTwilioCallSid: (call_id, sid) => t.mutation(fns.setTwilioCallSid, { secret: s, call_id, sid }).then(() => undefined),
    markInProgress: (call_id) => t.mutation(fns.markInProgress, { secret: s, call_id }).then(() => undefined),
    appendEvent: (event) => t.mutation(fns.appendEvent, { secret: s, event }).then(() => undefined),
    reportNoAnswer: (call_id) => t.mutation(fns.reportNoAnswer, { secret: s, call_id }),
    finishCall: (result) => t.mutation(fns.finishCall, { secret: s, result }).then(() => undefined),
    watchPersonAnswer: () => {
      throw new Error("not used in these scenarios");
    },
    closeAsk: (call_id, ask_id) => t.mutation(fns.closeAsk, { secret: s, call_id, ask_id }),
    attachRecording: async (call_id, audio, contentType) => {
      const storage_id = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(audio)], { type: contentType })));
      await t.mutation(fns.attachRecording, { secret: s, call_id, storage_id });
    },
    getSupplierProfile: (supplier_id) => t.query(fns.getSupplierProfile, { secret: s, supplier_id }),
    listSupplierProfiles: () => t.query(fns.listSupplierProfiles, { secret: s }),
    getSupplierRecords: (supplier_id) => t.query(fns.getSupplierRecords, { secret: s, supplier_id }),
    getPhonePlaybook: () => t.query(fns.phonePlaybook, { secret: s }),
    getCompany: () => t.query(api.app.company.current, {}),
    startInboundCall: (call_id, caller_number) =>
      t.mutation(fns.startInboundCall, { secret: s, call_id, caller_number }).then(() => undefined),
    finishInboundCall: (record) => t.mutation(fns.finishInboundCall, { secret: s, record }),
  };
  return {
    store,
    addRequest: async (req) => {
      await t.run((ctx) => ctx.db.insert("callRequests", { ...req, status: "queued", attempt: 0 }));
    },
    addSupplier: async () => {
      await t.run((ctx) => ctx.db.insert("suppliers", STAGE_ROW));
    },
    takeover: (call_id) => t.mutation(api.voice.ui.requestTakeover, { call_id }).then(() => undefined),
    runRetry: async () => {
      vi.advanceTimersByTime(RETRY_MS + 1);
      await t.finishInProgressScheduledFunctions();
    },
    results: (call_id) =>
      t.run(async (ctx) =>
        (await ctx.db.query("callResults").collect()).filter((r) => r.call_id === call_id).map(toCallResult),
      ),
    events: (call_id) =>
      t.run(async (ctx) =>
        (await ctx.db.query("callEvents").collect())
          .filter((e) => e.call_id === call_id)
          .map(({ _id, _creationTime, ...e }) => e as CallEvent),
      ),
    request: (call_id) =>
      t.run(async (ctx) => {
        const r = (await ctx.db.query("callRequests").collect()).find((x) => x.call_id === call_id);
        return r ? { ...toCallRequest(r), retry_at_ms: r.retry_at_ms } : null;
      }),
    inboundRecordingUrl: (call_id) =>
      t.run(async (ctx) => (await ctx.db.query("inboundCalls").collect()).find((x) => x.call_id === call_id)?.recording_url),
  };
}

function memoryHarness(): Harness {
  const m = new MemoryStore({ retryDelayMs: RETRY_MS });
  return {
    store: m,
    addRequest: async (req) => m.addRequest(req),
    addSupplier: async () => {
      m.suppliers.set(STAGE.supplier_id, STAGE);
    },
    takeover: (call_id) => m.requestTakeover(call_id),
    runRetry: async () => {
      vi.advanceTimersByTime(RETRY_MS + 1);
    },
    results: async (call_id) => [...m.results.values()].filter((r) => r.call_id === call_id),
    events: async (call_id) => m.eventsFor(call_id),
    request: async (call_id) => {
      const r = m.requests.get(call_id);
      return r ? { ...r } : null;
    },
    inboundRecordingUrl: async (call_id) => m.inbound.get(call_id)?.recording_url,
  };
}

const statuses = (events: CallEvent[]) => events.flatMap((e) => (e.type === "status" ? [e.value] : []));

describe.each([
  ["convex", convexHarness],
  ["memory", memoryHarness],
] as const)("VoiceStore semantics (%s)", (_name, make) => {
  let h: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T21:13:00Z")); // 2:13 PM in San Francisco
    vi.stubEnv("VOICE_SERVER_SECRET", SECRET);
    vi.stubEnv("CALL_RETRY_DELAY_MS", String(RETRY_MS));
    h = make();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("claim is atomic: two racing claims, one winner", async () => {
    await h.addRequest(baseRequest);
    const [a, b] = await Promise.all([h.store.claimRequest("call_1"), h.store.claimRequest("call_1")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const won = (a ?? b)!;
    expect(won.status).toBe("dialing");
    expect(won.attempt).toBe(1);
    expect(await h.store.claimRequest("call_1")).toBeNull();
    expect(await h.store.claimRequest("nope")).toBeNull();
  });

  test("no answer: one retry at a displayed time, then hand-off", async () => {
    await h.addRequest(baseRequest);
    await h.store.claimRequest("call_1");
    const before = Date.now();
    const first = await h.store.reportNoAnswer("call_1");
    expect(first.retry_at_ms! - before).toBeGreaterThanOrEqual(RETRY_MS);
    expect(first.retry_at_ms! - before).toBeLessThan(RETRY_MS + 1000); // convex-test ticks the clock per transaction
    expect((await h.request("call_1"))?.status).toBe("retry_scheduled");
    const retryEvent = (await h.events("call_1")).find((e) => e.type === "status" && e.value === "retry_scheduled");
    expect(retryEvent).toMatchObject({ retry_at: "2:15 PM", retry_at_ms: first.retry_at_ms });
    expect(formatRetryAt(first.retry_at_ms!)).toBe("2:15 PM");

    // Duplicate report for the same attempt changes nothing.
    expect(await h.store.reportNoAnswer("call_1")).toEqual(first);
    expect(await h.store.claimRequest("call_1")).toBeNull(); // not queued until the retry time

    await h.runRetry();
    expect((await h.request("call_1"))?.status).toBe("queued");
    const second = await h.store.claimRequest("call_1");
    expect(second?.attempt).toBe(2);

    expect(await h.store.reportNoAnswer("call_1")).toEqual({ retry_at_ms: null });
    expect((await h.request("call_1"))?.status).toBe("handed_off");
    expect(await h.results("call_1")).toEqual([
      { call_id: "call_1", outcome: "handed_off", evidence: [], summary: "No answer after 2 attempts" },
    ]);
    expect(statuses(await h.events("call_1"))).toEqual(["no_answer", "retry_scheduled", "no_answer", "ended"]);
    expect(await h.store.reportNoAnswer("call_1")).toEqual({ retry_at_ms: null }); // closed: no-op
  });

  test("finishCall is idempotent and never overwrites a result", async () => {
    await h.addRequest(baseRequest);
    await h.store.claimRequest("call_1");
    await h.store.markInProgress("call_1");
    const result: CallResult = {
      call_id: "call_1",
      outcome: "not_confirmed",
      evidence: [{ ask: "Did you change your bank?", answer: "No, we never changed our bank.", matches: false }],
      summary: "Supplier says they never changed bank details.",
      clip: { start_s: 41, end_s: 47 },
    };
    await h.store.finishCall(result);
    await h.store.finishCall({ ...result, outcome: "confirmed", summary: "overwritten?" });
    expect(await h.results("call_1")).toEqual([result]);
    expect((await h.request("call_1"))?.status).toBe("done");
    expect(statuses(await h.events("call_1"))).toEqual(["ended"]);
    await h.store.markInProgress("call_1"); // late status update cannot reopen a closed call
    expect((await h.request("call_1"))?.status).toBe("done");
  });

  test("handed_off outcome closes the request as handed_off", async () => {
    await h.addRequest(baseRequest);
    await h.store.claimRequest("call_1");
    await h.store.finishCall({ call_id: "call_1", outcome: "handed_off", evidence: [], summary: "Call dropped" });
    expect((await h.request("call_1"))?.status).toBe("handed_off");
  });

  test("never reports a result it didn't get", async () => {
    await h.addRequest(baseRequest);
    await h.store.claimRequest("call_1");
    await h.store.markInProgress("call_1");
    await h.store.appendEvent({ call_id: "call_1", type: "status", value: "in_progress" });
    await h.store.appendEvent({
      call_id: "call_1",
      type: "question",
      ask: "Can you confirm the total on your September invoice #4471?",
      source: { kind: "invoice", ref: "#4471" },
    });
    await h.store.appendEvent({ call_id: "call_1", type: "segment", speaker: "supplier", text: "Sure, it was", ts: 12 });
    // The call is mid-way: nothing may be on the bill page yet.
    expect(await h.results("call_1")).toEqual([]);
    expect((await h.request("call_1"))?.status).toBe("in_progress");
    await expect(h.store.reportNoAnswer("missing")).rejects.toThrow();
  });

  test("a queued request cannot be reported as no-answer", async () => {
    await h.addRequest(baseRequest);
    await expect(h.store.reportNoAnswer("call_1")).rejects.toThrow(/never claimed/);
    expect(await h.results("call_1")).toEqual([]);
  });

  test("takeover while waiting for the retry hands off and cancels the retry", async () => {
    await h.addRequest(baseRequest);
    await h.store.claimRequest("call_1");
    await h.store.reportNoAnswer("call_1");
    await h.takeover("call_1");
    expect((await h.request("call_1"))?.status).toBe("handed_off");
    await h.runRetry();
    expect((await h.request("call_1"))?.status).toBe("handed_off");
    expect((await h.results("call_1"))[0]?.outcome).toBe("handed_off");
  });

  test("recording attached before the result is copied onto it", async () => {
    await h.addRequest(baseRequest);
    await h.store.claimRequest("call_1");
    await h.store.attachRecording("call_1", new Uint8Array([1, 2, 3]), "audio/wav");
    await h.store.finishCall({ call_id: "call_1", outcome: "confirmed", evidence: [], summary: "ok" });
    expect((await h.results("call_1"))[0]?.recording_url).toBeTruthy();
  });

  test("recording attached after the result updates it", async () => {
    await h.addRequest(baseRequest);
    await h.store.claimRequest("call_1");
    await h.store.finishCall({ call_id: "call_1", outcome: "confirmed", evidence: [], summary: "ok" });
    expect((await h.results("call_1"))[0]?.recording_url).toBeUndefined();
    await h.store.attachRecording("call_1", new Uint8Array([1, 2, 3]), "audio/wav");
    expect((await h.results("call_1"))[0]?.recording_url).toBeTruthy();
  });

  test("an incoming call's recording survives the call being closed", async () => {
    await h.store.startInboundCall("in_CA1", "+19995550000");
    await h.store.attachRecording("in_CA1", new Uint8Array([1, 2, 3]), "audio/mpeg");
    await h.store.finishInboundCall({
      call_id: "in_CA1",
      caller_number: "+19995550000",
      claimed_identity: "",
      requested: "",
      asked_bank_change: false,
      transcript: [],
    });
    expect(await h.inboundRecordingUrl("in_CA1")).toBeTruthy();
  });

  test("inbound bank-change request calls back the number on file, never the caller", async () => {
    await h.addSupplier();
    await h.store.startInboundCall("in_CA1", "+19995550000");
    const record = {
      call_id: "in_CA1",
      caller_number: "+19995550000",
      claimed_identity: "Rosa at Stagecraft",
      claimed_supplier_id: "sup_stage",
      requested: "Change our bank account to a new one",
      asked_bank_change: true,
      transcript: [{ speaker: "caller" as const, text: "We changed banks, update it now.", ts: 3 }],
    };
    const { triggered_call_id } = await h.store.finishInboundCall(record);
    expect(triggered_call_id).toBe(followUpCallId("in_CA1"));
    const req = await h.request(triggered_call_id!);
    expect(req).toMatchObject({
      to_number: STAGE.phone_on_file,
      number_source: "on_file",
      supplier_id: "sup_stage",
      bill_id: "inbound:in_CA1",
      status: "queued",
      attempt: 0,
    });
    expect(req?.to_number).not.toBe(record.caller_number);
    expect(req?.reason[0]).toBe("Inbound caller asked to change bank details");

    // Idempotent: a second finish creates nothing new.
    expect(await h.store.finishInboundCall(record)).toEqual({ triggered_call_id });
  });

  test("inbound call without a resolvable supplier creates no follow-up", async () => {
    await h.store.startInboundCall("in_CA2", "+19995550000");
    const res = await h.store.finishInboundCall({
      call_id: "in_CA2",
      caller_number: "+19995550000",
      claimed_identity: "Unknown caller",
      claimed_supplier_id: "sup_unknown",
      requested: "Change bank details",
      asked_bank_change: true,
      transcript: [],
    });
    expect(res).toEqual({ triggered_call_id: null });
    expect(await h.request(followUpCallId("in_CA2"))).toBeNull();
  });
});

describe("convex-only", () => {
  beforeEach(() => vi.stubEnv("VOICE_SERVER_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  test("voice-server functions reject a wrong or missing secret", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.voice.server.queuedRequests, { secret: "wrong" })).rejects.toThrow(/Unauthorized/);
    await expect(t.mutation(api.voice.server.claimRequest, { secret: "", call_id: "x" })).rejects.toThrow(
      /Unauthorized/,
    );
    vi.stubEnv("VOICE_SERVER_SECRET", "");
    await expect(t.query(api.voice.server.queuedRequests, { secret: "" })).rejects.toThrow(/not set/);
  });

  test("liveCall, activeCall and phoneLine", async () => {
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+14155550100");
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("callRequests", { ...baseRequest, status: "queued", attempt: 0 }));
    expect((await t.query(api.voice.ui.activeCall, {}))?.call_id).toBe("call_1"); // queued counts: the screen opens as soon as the call is requested
    await t.mutation(api.voice.server.claimRequest, { secret: SECRET, call_id: "call_1" });
    expect((await t.query(api.voice.ui.activeCall, {}))?.call_id).toBe("call_1");

    for (const text of ["one", "two", "three"]) {
      await t.mutation(api.voice.server.appendEvent, {
        secret: SECRET,
        event: { call_id: "call_1", type: "segment", speaker: "callback", text, ts: 0 },
      });
    }
    expect((await t.query(api.voice.ui.liveCall, { call_id: "call_1" })).supplier).toBeNull(); // no suppliers row yet
    await t.run((ctx) => ctx.db.insert("suppliers", STAGE_ROW));
    const live = await t.query(api.voice.ui.liveCall, { call_id: "call_1" });
    expect(live.supplier).toEqual({ name: "Stagecraft Rigging Co.", contactName: "Rosa Quintero" });
    expect((await t.query(api.voice.ui.liveCall, { call_id: "nope" })).supplier).toBeNull();
    expect(live.events.map((e) => (e.type === "segment" ? e.text : null))).toEqual(["one", "two", "three"]);
    expect(live.result).toBeNull();

    await t.mutation(api.voice.server.startInboundCall, { secret: SECRET, call_id: "in_1", caller_number: "+1999" });
    await t.mutation(api.voice.server.appendEvent, {
      secret: SECRET,
      event: { call_id: "in_1", type: "segment", speaker: "caller", text: "hello", ts: 1 },
    });
    let line = await t.query(api.voice.ui.phoneLine, {});
    expect(line.number).toBe("+14155550100");
    expect(line.active.map((c) => c.transcript)).toEqual([[{ speaker: "caller", text: "hello", ts: 1 }]]);
    expect(line.past).toEqual([]);
    await t.mutation(api.voice.server.finishInboundCall, {
      secret: SECRET,
      record: {
        call_id: "in_1",
        caller_number: "+1999",
        claimed_identity: "Unknown caller",
        requested: "",
        asked_bank_change: false,
        transcript: [],
      },
    });
    line = await t.query(api.voice.ui.phoneLine, {});
    expect(line.active).toEqual([]);
    expect(line.past.map((c) => c.call_id)).toEqual(["in_1"]);
  });

  test("records adapter reads the real Fogline seed, without planted scams", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seed, fogline as never);
    const profile = await t.query(api.voice.server.getSupplierProfile, { secret: SECRET, supplier_id: "sup_stage" });
    expect(profile).toMatchObject({ name: "Stagecraft Rigging Co.", phone_on_file: "+14155550100" });
    expect(profile?.aliases).toEqual(["Stagecraft Rigging", "Stagecraft"]);

    const recs = await t.query(api.voice.server.getSupplierRecords, { secret: SECRET, supplier_id: "sup_stage" });
    expect(recs.filter((r) => r.kind === "email")).toHaveLength(14);
    expect(recs.find((r) => r.ref === "#4471")).toMatchObject({ kind: "invoice", amount_cents: 1840000 });
    expect(recs.find((r) => r.ref === "#4471")?.text).toMatch(/^September 2026 invoice #4471 for main-stage truss rental\. Total \$18,400\.00/);
    expect(recs.find((r) => r.id === "call_4471_verify")).toMatchObject({ ref: "Call 3 Sep" });
    expect(recs.find((r) => r.id === "call_4471_verify")?.text).toContain("4471");
    expect(recs.some((r) => r.kind === "payment" && r.text.includes("#4471"))).toBe(true);
    // No bank account digits ever reach Moss text.
    const accountDigits = fogline.bankAccounts.flatMap((a) => [a.last4, a.routingLast4]);
    for (const r of recs) for (const d of accountDigits) expect(r.text).not.toMatch(new RegExp(`\\b${d}\\b`));
    expect(recs.map((r) => r.date)).toEqual([...recs.map((r) => r.date)].sort());

    // A planted scam bill (and its email/call) is not part of the supplier's real history.
    const fogcity = await t.query(api.voice.server.getSupplierRecords, {
      secret: SECRET,
      supplier_id: "sup_fogcity_ramen",
    });
    expect(fogcity.length).toBeGreaterThan(0);
    expect(fogcity.some((r) => r.ref === "#4141" || r.text.includes("8832"))).toBe(false);
  });

  test("styleMatch with no past emails answers without calling Claude", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(api.voice.styleMatch.styleMatch, { supplier_id: "sup_none", email_text: "Hi" });
    expect(res).toMatchObject({ matches: false, score: 0, compared_with: 0 });
  });
});
