import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_TUNING } from "../config.js";
import type { SttSink } from "./cartesiaStt.js";
import type { TtsSink } from "./cartesiaTts.js";
import { encodeMulaw } from "./mulaw.js";
import { PhoneTransport, soundsUnfinished, type TwilioOutbound } from "./phoneTransport.js";

const frame = (amplitude: number) =>
  encodeMulaw(Array.from({ length: 160 }, (_, i) => amplitude * Math.sin((2 * Math.PI * 300 * i) / 8000)));
const QUIET = frame(30);
const SPEECH = frame(9000);

function setup() {
  const twilio: TwilioOutbound[] = [];
  const ttsSent: { ctx: string; text: string; more: boolean }[] = [];
  const cancelled: string[] = [];
  const stt = { sent: 0, finalized: 0, closed: false };
  let sttSink!: SttSink;
  let ttsSink!: TtsSink;
  const hangupCall = vi.fn(async () => undefined);
  const closeSocket = vi.fn();
  const t = new PhoneTransport({
    callId: "call_1",
    streamSid: "MZ1",
    sendToTwilio: (m) => twilio.push(m),
    hangupCall,
    closeSocket,
    stt: (sink) => {
      sttSink = sink;
      return {
        send: () => void stt.sent++,
        finalize: () => void stt.finalized++,
        close: () => void (stt.closed = true),
      };
    },
    tts: (sink) => {
      ttsSink = sink;
      return {
        send: (ctx, text, more) => void ttsSent.push({ ctx, text, more }),
        cancel: (ctx) => void cancelled.push(ctx),
        close: () => undefined,
      };
    },
    tuning: DEFAULT_TUNING,
  });
  const marks = () => twilio.flatMap((m) => (m.event === "mark" ? [m.mark.name] : []));
  const media = () => twilio.filter((m) => m.event === "media");
  const feed = (f: Uint8Array, n: number) => {
    for (let i = 0; i < n; i++) t.onMedia(f);
  };
  const ackAll = () => marks().forEach((m) => t.onMark(m));
  return { t, twilio, ttsSent, cancelled, stt, sttSink: () => sttSink, ttsSink: () => ttsSink, hangupCall, closeSocket, marks, media, feed, ackAll };
}

/** 100 ms of mu-law audio. */
const audio = () => Buffer.alloc(800, 0xff);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("say()", () => {
  test("plays to the end and resolves only after Twilio confirms playback", async () => {
    const h = setup();
    let done = false;
    const p = h.t.say("Hello there.").then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ttsSent).toEqual([{ ctx: expect.any(String), text: "Hello there.", more: false }]);
    const ctx = h.ttsSent[0]!.ctx;
    h.ttsSink().audio(ctx, audio());
    h.ttsSink().audio(ctx, audio());
    h.ttsSink().done(ctx);
    expect(h.media()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(false); // audio still playing on the phone
    h.ackAll();
    const r = await p;
    expect(r).toMatchObject({ interrupted: false, spokenText: "Hello there." });
    expect(r.end_s).toBeGreaterThanOrEqual(r.start_s);
  });

  test("finishes anyway if Twilio's last mark never arrives", async () => {
    const h = setup();
    const p = h.t.say("Hi.");
    await vi.advanceTimersByTimeAsync(0);
    const ctx = h.ttsSent[0]!.ctx;
    h.ttsSink().audio(ctx, audio());
    h.ttsSink().done(ctx);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).interrupted).toBe(false);
  });

  test("streams text chunks as continuations, split on word boundaries", async () => {
    const h = setup();
    async function* tokens() {
      yield "Can you con";
      yield "firm the total ";
      yield "on invoice 4471?";
    }
    const p = h.t.say(tokens());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ttsSent.map((s) => [s.text, s.more])).toEqual([
      ["Can you ", true],
      ["confirm the total ", true],
      ["on invoice ", true],
      ["4471?", false],
    ]);
    expect(new Set(h.ttsSent.map((s) => s.ctx)).size).toBe(1);
    const ctx = h.ttsSent[0]!.ctx;
    h.ttsSink().done(ctx);
    expect(await p).toMatchObject({ interrupted: false, spokenText: "Can you confirm the total on invoice 4471?" });
  });

  test("an empty say resolves at once without calling Cartesia", async () => {
    const h = setup();
    expect(await h.t.say("")).toMatchObject({ interrupted: false, spokenText: "" });
    expect(h.ttsSent).toEqual([]);
  });

  test("retries the ungenerated remainder on a fresh context if Cartesia fails mid-say", async () => {
    const h = setup();
    const p = h.t.say("One two three four.");
    await vi.advanceTimersByTimeAsync(0);
    const first = h.ttsSent[0]!.ctx;
    h.ttsSink().words(first, ["One", "two"], [0, 0.2]);
    h.ttsSink().audio(first, audio());
    h.ttsSink().error(first, new Error("socket closed"));
    expect(h.ttsSent[1]).toMatchObject({ text: " three four.", more: false });
    const second = h.ttsSent[1]!.ctx;
    expect(second).not.toBe(first);
    h.ttsSink().audio(second, audio());
    h.ttsSink().done(second);
    h.ackAll();
    expect(await p).toMatchObject({ interrupted: false, spokenText: "One two three four." });
  });
});

describe("barge-in", () => {
  async function speaking(h: ReturnType<typeof setup>, opts?: { opening: boolean }) {
    const p = h.t.say("Hi, this is an automated assistant calling for Fogline.", opts);
    await vi.advanceTimersByTimeAsync(0);
    const ctx = h.ttsSent[0]!.ctx;
    h.ttsSink().words(ctx, ["Hi,", "this", "is", "an", "automated"], [0, 0.3, 0.5, 0.6, 0.8]);
    for (let i = 0; i < 20; i++) h.ttsSink().audio(ctx, audio()); // 2 s generated
    return { p, ctx };
  }

  test("sustained caller speech clears Twilio, cancels Cartesia and reports what was heard", async () => {
    const h = setup();
    h.feed(QUIET, 50);
    const { p, ctx } = await speaking(h);
    await vi.advanceTimersByTimeAsync(550); // 0.55 s of playback
    h.feed(SPEECH, 29);
    expect(h.twilio.some((m) => m.event === "clear")).toBe(false); // 580 ms is not enough
    h.feed(SPEECH, 1);
    expect(h.twilio.at(-1)).toEqual({ event: "clear", streamSid: "MZ1" });
    expect(h.cancelled).toContain(ctx);
    const r = await p;
    expect(r.interrupted).toBe(true);
    expect(r.spokenText).toBe("Hi, this is");

    // Late audio for the cancelled context is dropped, and marks echoed by "clear" are ignored.
    const before = h.media().length;
    h.ttsSink().audio(ctx, audio());
    h.ackAll();
    expect(h.media()).toHaveLength(before);
  });

  test("an STT partial with enough words also interrupts", async () => {
    const h = setup();
    const { p } = await speaking(h);
    h.sttSink().partial("sorry");
    expect(h.twilio.some((m) => m.event === "clear")).toBe(false);
    h.sttSink().partial("sorry who");
    expect((await p).interrupted).toBe(true);
  });

  test("a backchannel \"Yeah.\" over a question does not cut it off", async () => {
    const h = setup();
    h.feed(QUIET, 50);
    const { p, ctx } = await speaking(h);
    h.feed(SPEECH, 20); // 400 ms of "Yeah."
    h.feed(QUIET, 20);
    h.sttSink().final("Yeah.");
    expect(h.twilio.some((m) => m.event === "clear")).toBe(false);
    h.ttsSink().done(ctx);
    h.ackAll();
    expect((await p).interrupted).toBe(false);
  });

  test("a short noise does not interrupt", async () => {
    const h = setup();
    h.feed(QUIET, 50);
    await speaking(h);
    h.feed(SPEECH, 4);
    h.feed(QUIET, 10);
    expect(h.twilio.some((m) => m.event === "clear")).toBe(false);
  });

  test("the opening line plays through a pickup \"Hello?\": voice alone and one word don't cut it", async () => {
    const h = setup();
    h.feed(QUIET, 50);
    const { p, ctx } = await speaking(h, { opening: true });
    h.feed(SPEECH, 25); // half a second of loud "Hello?"
    h.sttSink().final("Hello?");
    h.sttSink().partial("Hello? Hi");
    expect(h.twilio.some((m) => m.event === "clear")).toBe(false);
    h.ttsSink().done(ctx);
    h.ackAll();
    expect((await p).interrupted).toBe(false);
  });

  test("a real interruption still cuts the opening line", async () => {
    const h = setup();
    const { p } = await speaking(h, { opening: true });
    h.sttSink().partial("I need to");
    expect((await p).interrupted).toBe(true);
  });

  test("the words that interrupted are the next listen() result", async () => {
    const h = setup();
    h.feed(QUIET, 50);
    const { p } = await speaking(h);
    h.feed(SPEECH, 30);
    await p;
    h.sttSink().final("Sorry, who is this?");
    h.feed(QUIET, 20); // caller stops: VAD offset -> finalize
    expect(h.stt.finalized).toBe(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_TUNING.endOfTurnMs + 10);
    const u = await h.t.listen({ timeoutMs: 1000 });
    expect(u?.text).toBe("Sorry, who is this?");
  });
});

describe("listen()", () => {
  test("queues utterances heard while nobody listens and returns them in order", async () => {
    const h = setup();
    h.sttSink().final("Hello?");
    await vi.advanceTimersByTimeAsync(300);
    h.sttSink().final("Anyone there?");
    await vi.advanceTimersByTimeAsync(300);
    expect((await h.t.listen({ timeoutMs: 10 }))?.text).toBe("Hello?");
    expect((await h.t.listen({ timeoutMs: 10 }))?.text).toBe("Anyone there?");
  });

  test("joins final deltas verbatim into one turn", async () => {
    const h = setup();
    const p = h.t.listen({ timeoutMs: 5000 });
    h.sttSink().final("The total was");
    h.sttSink().final(" forty two hundred.");
    await vi.advanceTimersByTimeAsync(300);
    expect((await p)?.text).toBe("The total was forty two hundred.");
  });

  test("holds the turn while the caller is still talking", async () => {
    const h = setup();
    const p = h.t.listen({ timeoutMs: 5000 });
    let got: string | undefined;
    void p.then((u) => (got = u?.text));
    h.sttSink().final("Let me check,");
    h.sttSink().partial("it was");
    await vi.advanceTimersByTimeAsync(400);
    expect(got).toBeUndefined();
    h.sttSink().final(" it was paid.");
    await vi.advanceTimersByTimeAsync(300);
    expect(got).toBe("Let me check, it was paid.");
  });

  test("a thinking pause after \"Um…\" doesn't end the turn: the answer after it joins it", async () => {
    const h = setup();
    const p = h.t.listen({ timeoutMs: 10_000 });
    let got: string | undefined;
    void p.then((u) => (got = u?.text));
    h.sttSink().final("Um...");
    await vi.advanceTimersByTimeAsync(900); // a pause that used to end the turn
    expect(got).toBeUndefined();
    h.sttSink().final(" It was");
    await vi.advanceTimersByTimeAsync(900);
    expect(got).toBeUndefined();
    h.sttSink().final(" paid in March.");
    await vi.advanceTimersByTimeAsync(DEFAULT_TUNING.endOfTurnMs + 50);
    expect(got).toBe("Um... It was paid in March.");
  });

  test("a finished answer still ends the turn quickly", async () => {
    const h = setup();
    const p = h.t.listen({ timeoutMs: 10_000 });
    h.sttSink().final("Thank you.");
    await vi.advanceTimersByTimeAsync(DEFAULT_TUNING.endOfTurnMs + 50);
    expect((await p)?.text).toBe("Thank you.");
  });

  test("someone who only says \"um\" and stops is still heard", async () => {
    const h = setup();
    const p = h.t.listen({ timeoutMs: 10_000 });
    h.sttSink().final("Um.");
    await vi.advanceTimersByTimeAsync(DEFAULT_TUNING.hesitationEndOfTurnMs + 50);
    expect((await p)?.text).toBe("Um.");
  });

  test("a partial that never turns final cannot hold the turn open forever", async () => {
    const h = setup();
    const p = h.t.listen({ timeoutMs: 10_000 });
    h.sttSink().final("Yes, that's right.");
    h.sttSink().partial("uh huh"); // crowd noise mis-heard, never finalized
    await vi.advanceTimersByTimeAsync(2500);
    expect((await p)?.text).toBe("Yes, that's right.");
  });

  test("resolves null after timeoutMs of silence, extended while the caller talks", async () => {
    const h = setup();
    let result: unknown = "pending";
    void h.t.listen({ timeoutMs: 1000 }).then((u) => (result = u));
    await vi.advanceTimersByTimeAsync(800);
    h.sttSink().partial("um");
    await vi.advanceTimersByTimeAsync(800);
    expect(result).toBe("pending");
    await vi.advanceTimersByTimeAsync(300);
    expect(result).toBeNull();
  });

  test("utterance times are seconds since answer", async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(2000);
    h.feed(QUIET, 50);
    h.feed(SPEECH, 25);
    h.sttSink().final("Yes.");
    h.feed(QUIET, 20);
    await vi.advanceTimersByTimeAsync(300);
    const u = (await h.t.listen({ timeoutMs: 10 }))!;
    expect(u.start_s).toBeGreaterThanOrEqual(1.7);
    expect(u.end_s).toBeGreaterThanOrEqual(u.start_s);
    expect(u.end_s).toBeLessThanOrEqual(h.t.elapsed());
  });
});

describe("ending", () => {
  test("a stream stop is a drop: pending listen and say resolve, ended says why", async () => {
    const h = setup();
    const l = h.t.listen({ timeoutMs: 10_000 });
    h.t.onStreamEnd();
    expect(await l).toBeNull();
    expect(await h.t.ended).toBe("dropped");
    expect(h.stt.closed).toBe(true);
    expect(await h.t.listen({ timeoutMs: 10 })).toBeNull();
    expect((await h.t.say("hi")).interrupted).toBe(true);
  });

  test("words transcribed as the line goes are still heard", async () => {
    const h = setup();
    h.sttSink().final("We never changed our bank.");
    h.t.onStreamEnd(); // before the end-of-turn timer
    expect((await h.t.listen({ timeoutMs: 10 }))?.text).toBe("We never changed our bank.");
    expect(await h.t.listen({ timeoutMs: 10 })).toBeNull();
  });

  test("hangup is idempotent and reports hangup", async () => {
    const h = setup();
    await h.t.hangup();
    await h.t.hangup();
    h.t.onStreamEnd();
    expect(await h.t.ended).toBe("hangup");
    expect(h.hangupCall).toHaveBeenCalledTimes(1);
    expect(h.closeSocket).toHaveBeenCalledTimes(1);
  });

  test("takeover wins over the stream stop that the redirect causes", async () => {
    const h = setup();
    const p = h.t.say("Hello");
    await vi.advanceTimersByTimeAsync(0);
    h.t.markTakeover();
    h.t.onStreamEnd();
    expect(await h.t.ended).toBe("takeover");
    expect((await p).interrupted).toBe(true);
    await h.t.hangup();
    expect(h.hangupCall).not.toHaveBeenCalled();
  });
});

describe("soundsUnfinished", () => {
  test.each([
    ["Um...", true],
    ["Uh", true],
    ["Um… it was", true],
    ["Let me check,", true],
    ["The total was", true],
    ["Eh, este", true],
    ["Fue el", true],
    ["Thank you.", false],
    ["It was paid in March.", false],
    ["Yes, that's right.", false],
    ["No.", false],
    ["Sí, correcto.", false],
    ["", false],
  ])("%j -> %s", (text, unfinished) => {
    expect(soundsUnfinished(text)).toBe(unfinished);
  });
});
