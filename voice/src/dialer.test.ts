import { afterEach, describe, expect, test, vi } from "vitest";
import type { CallRequest, CallResult } from "../../shared/contract.js";
import type { SupplierSearch } from "../../shared/search.js";
import type { PhoneTransport } from "./audio/phoneTransport.js";
import type { DialParams, TwilioApi } from "./audio/twilio.js";
import type { OutboundCallDeps, PreparedCall } from "./call/index.js";
import type { LLM } from "./call/llm.js";
import type { EndReason } from "./call/transport.js";
import { Dialer, type DialerDeps } from "./dialer.js";
import { MemoryStore } from "./store/memoryStore.js";

const PREPARED: PreparedCall = {
  supplierName: "Northgate Staging",
  questions: [{ ask: "Can you confirm the total on invoice 4471?", expected: "$4,200", source: { kind: "invoice", ref: "#4471" } }],
};

const request = (over: Partial<CallRequest> = {}) => ({
  call_id: "call_1",
  bill_id: "bill_4471",
  supplier_id: "sup_stage",
  to_number: "+14155550123",
  number_source: "on_file" as const,
  reason: ["new bank account"],
  ...over,
});

class FakeTwilio implements TwilioApi {
  dials: DialParams[] = [];
  hangups: string[] = [];
  redirects: { sid: string; twiml: string }[] = [];
  log: string[] = [];
  async dial(p: DialParams) {
    this.dials.push(p);
    return { sid: `CA${this.dials.length}` };
  }
  async hangup(sid: string) {
    this.hangups.push(sid);
    this.log.push(`hangup ${sid}`);
  }
  async redirect(sid: string, twiml: string) {
    this.redirects.push({ sid, twiml });
    this.log.push(`redirect ${sid}`);
  }
  async startRecording() {}
  async downloadRecording() {
    return new Uint8Array();
  }
}

/** Stand-in for PhoneTransport: just the parts the dialer touches. */
function fakeTransport() {
  let resolve!: (r: EndReason) => void;
  const ended = new Promise<EndReason>((r) => (resolve = r));
  let reason: EndReason | null = null;
  const end = (r: EndReason) => {
    if (!reason) resolve((reason = r));
  };
  return {
    ended,
    markTakeover: () => end("takeover"),
    onStreamEnd: () => end("dropped"),
    hangup: vi.fn(async () => end("hangup")),
  };
}

function setup(over: Partial<DialerDeps> = {}) {
  const store = new MemoryStore({ retryDelayMs: 10 });
  const twilio = new FakeTwilio();
  const prepare = vi.fn(async () => PREPARED);
  const runs: OutboundCallDeps[] = [];
  let finishRun!: () => void;
  const run = vi.fn(async (deps: OutboundCallDeps): Promise<CallResult> => {
    runs.push(deps);
    await deps.store.markInProgress(deps.request.call_id);
    // Behave like the conversation layer: end on takeover, finish when the transport ends.
    const unwatch = deps.store.watchTakeover(deps.request.call_id, () => void deps.transport.hangup());
    await Promise.race([deps.transport.ended, new Promise<void>((r) => (finishRun = r))]);
    unwatch();
    const result: CallResult = { call_id: deps.request.call_id, outcome: "handed_off", evidence: [], summary: "test" };
    await deps.store.finishCall(result);
    return result;
  });
  const dialer = new Dialer({
    store,
    search: {} as SupplierSearch,
    llm: {} as LLM,
    twilio,
    publicBaseUrl: "https://abc.ngrok-free.app",
    fromNumber: "+14155550199",
    amd: true,
    ringTimeoutS: 25,
    prepare,
    run,
    simulated: async () => fakeTransport() as never,
    ...over,
  });
  return { store, twilio, prepare, run, runs, dialer, finishRun: () => finishRun() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
let cleanup: (() => void) | null = null;
afterEach(() => cleanup?.());

describe("Dialer", () => {
  test("dials only to_number, emits ringing, and records the call sid", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    h.store.addRequest(request());
    h.dialer.start();
    await flush();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.twilio.dials).toHaveLength(1);
    expect(h.twilio.dials[0]).toMatchObject({
      to: "+14155550123",
      from: "+14155550199",
      url: "https://abc.ngrok-free.app/twilio/outbound/call_1",
      statusCallback: "https://abc.ngrok-free.app/twilio/status?callId=call_1",
      amd: true,
    });
    expect(h.store.eventsFor("call_1")).toContainEqual({ call_id: "call_1", type: "status", value: "ringing" });
    expect(h.store.requests.get("call_1")?.twilio_call_sid).toBe("CA1");
  });

  test("never dials the same request twice, even if the subscription repeats it", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    let push!: (r: CallRequest[]) => void;
    vi.spyOn(h.store, "watchQueuedRequests").mockImplementation((cb) => ((push = cb), () => undefined));
    h.store.addRequest(request());
    h.dialer.start();
    const queued = { ...request(), status: "queued" as const, attempt: 0 };
    push([queued]);
    push([queued]);
    push([queued]);
    await flush();
    push([queued]); // a stale snapshot after the claim
    await flush();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.twilio.dials).toHaveLength(1);
  });

  test("refuses numbers that are not from a trusted source or not E.164", async () => {
    for (const bad of [{ number_source: "email" as never }, { to_number: "415-555-0123" }]) {
      const h = setup();
      h.store.addRequest(request(bad));
      h.dialer.start();
      await flush();
      expect(h.twilio.dials).toHaveLength(0);
      expect(h.store.results.get("call_1")?.outcome).toBe("handed_off");
      h.store.dispose();
    }
  });

  test("no answer -> one retry -> handed off", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    h.store.addRequest(request());
    h.dialer.start();
    await flush();
    await h.dialer.onStatus("call_1", "CA1", "no_answer");
    expect(h.store.eventsFor("call_1").map((e) => e.type === "status" && e.value)).toContain("retry_scheduled");
    await new Promise((r) => setTimeout(r, 30)); // retry delay, then the row is queued again
    expect(h.twilio.dials).toHaveLength(2);
    await h.dialer.onStatus("call_1", "CA2", "no_answer");
    expect(h.store.results.get("call_1")?.outcome).toBe("handed_off");
    await new Promise((r) => setTimeout(r, 30));
    expect(h.twilio.dials).toHaveLength(2);
  });

  test("a stale status for an older call sid is ignored", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    h.store.addRequest(request());
    h.dialer.start();
    await flush();
    await h.dialer.onStatus("call_1", "CA_OLD", "no_answer");
    expect(h.store.requests.get("call_1")?.status).toBe("dialing");
  });

  test("an answered stream runs the conversation with the prepared questions", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    h.store.addRequest(request());
    h.dialer.start();
    await flush();
    const t = fakeTransport();
    const done = h.dialer.attachStream("call_1", "CA1", t as unknown as PhoneTransport);
    await flush();
    expect(h.runs[0]?.prepared).toBe(PREPARED);
    expect(h.runs[0]?.request.attempt).toBe(1);
    // The call's "completed" status after the conversation is not a no-answer.
    h.finishRun();
    await done;
    await h.dialer.onStatus("call_1", "CA1", "completed");
    expect(h.store.eventsFor("call_1").some((e) => e.type === "status" && e.value === "no_answer")).toBe(false);
    expect(h.dialer.activeCalls).toBe(0);
  });

  test("a stream for an unknown call is hung up", async () => {
    const h = setup();
    const t = fakeTransport();
    await h.dialer.attachStream("call_x", "CA9", t as unknown as PhoneTransport);
    expect(t.hangup).toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
  });

  test("voicemail mid-call: hang up, report no answer, drop the conversation's writes", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    h.store.addRequest(request());
    h.dialer.start();
    await flush();
    const t = fakeTransport();
    const done = h.dialer.attachStream("call_1", "CA1", t as unknown as PhoneTransport);
    await flush();
    await h.dialer.onStatus("call_1", "CA1", "machine");
    expect(h.twilio.hangups).toEqual(["CA1"]);
    expect(h.store.requests.get("call_1")?.status).toBe("retry_scheduled");
    t.onStreamEnd(); // Twilio closes the stream after the hangup
    await done;
    expect(h.store.results.has("call_1")).toBe(false); // the conversation's handed_off was dropped
  });

  test("takeover during a live call redirects to Maya before the conversation layer reacts", async () => {
    const h = setup({ mayaNumber: "+14155550100" });
    cleanup = () => h.store.dispose();
    h.store.addRequest(request());
    h.dialer.start();
    await flush();
    const t = fakeTransport();
    const done = h.dialer.attachStream("call_1", "CA1", t as unknown as PhoneTransport);
    await flush();
    h.store.requestTakeover("call_1");
    await done;
    expect(await t.ended).toBe("takeover");
    expect(h.twilio.redirects).toEqual([{ sid: "CA1", twiml: expect.stringContaining("<Dial callerId=\"+14155550199\">+14155550100</Dial>") }]);
    expect(h.twilio.hangups).toEqual([]);
    expect(h.store.results.get("call_1")?.outcome).toBe("handed_off");
  });

  test("takeover while ringing cancels the call and hands off", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    h.store.addRequest(request());
    h.dialer.start();
    await flush();
    h.store.requestTakeover("call_1");
    await flush();
    expect(h.twilio.hangups).toEqual(["CA1"]);
    expect(h.store.results.get("call_1")?.summary).toMatch(/before the call was answered/);
  });

  test("simulated requests never dial", async () => {
    const simulated = vi.fn(async () => fakeTransport() as never);
    const h = setup({ simulated });
    cleanup = () => h.store.dispose();
    h.store.addRequest(request({ mode: "simulated" }));
    h.dialer.start();
    await flush();
    expect(h.twilio.dials).toHaveLength(0);
    expect(simulated).toHaveBeenCalledWith(expect.objectContaining({ call_id: "call_1" }), PREPARED);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  test("stop() stops picking up new requests", async () => {
    const h = setup();
    cleanup = () => h.store.dispose();
    h.dialer.start();
    await h.dialer.stop(0);
    h.store.addRequest(request());
    await flush();
    expect(h.twilio.dials).toHaveLength(0);
  });
});
