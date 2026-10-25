import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { CartesiaStt, cartesiaSttFactory, keytermsWithinLimits } from "./cartesiaStt.js";
import { CartesiaTts } from "./cartesiaTts.js";

let wss: WebSocketServer | null = null;
afterEach(() => wss?.close());

/** A local stand-in for Cartesia's websocket. Records what clients send. */
async function fakeCartesia() {
  wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss!.once("listening", r));
  const sockets: WebSocket[] = [];
  const received: { text?: string; bytes?: number; url: string; apiKey?: string }[] = [];
  wss.on("connection", (ws, req) => {
    sockets.push(ws);
    ws.on("message", (data, isBinary) =>
      received.push({
        url: req.url ?? "",
        apiKey: req.headers["x-api-key"] as string,
        ...(isBinary ? { bytes: (data as Buffer).length } : { text: data.toString() }),
      }),
    );
  });
  return { url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, sockets, received };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

describe("CartesiaStt", () => {
  test("sends mu-law with the right query, buffers until open, routes transcripts, reconnects", async () => {
    const srv = await fakeCartesia();
    const got: string[] = [];
    const stt = new CartesiaStt(
      { apiKey: "k", version: "2026-08-14", model: "ink-whisper", minVolume: 0.1, maxSilenceS: 0.4, url: srv.url },
      { partial: (t) => got.push(`p:${t}`), final: (t) => got.push(`f:${t}`) },
    );
    stt.send(new Uint8Array(160)); // before the socket is open
    await until(() => srv.received.length === 1);
    const q = new URL(srv.received[0]!.url, "ws://x").searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      model: "ink-whisper",
      encoding: "pcm_mulaw",
      sample_rate: "8000",
      cartesia_version: "2026-08-14",
      max_silence_duration_secs: "0.4",
    });
    expect(srv.received[0]).toMatchObject({ bytes: 160, apiKey: "k" });

    stt.finalize();
    await until(() => srv.received.some((m) => m.text === "finalize"));
    srv.sockets[0]!.send(JSON.stringify({ type: "transcript", is_final: false, text: "hel" }));
    srv.sockets[0]!.send(JSON.stringify({ type: "transcript", is_final: true, text: "Hello." }));
    await until(() => got.length === 2);
    expect(got).toEqual(["p:hel", "f:Hello."]);

    srv.sockets[0]!.terminate(); // Cartesia drops mid-call
    await until(() => srv.sockets.length === 2);
    stt.send(new Uint8Array(80));
    await until(() => srv.received.some((m) => m.bytes === 80));
    stt.close();
  });
});

describe("CartesiaStt on ink-2", () => {
  test("sends keyterms (not ink-whisper's language or silence settings)", async () => {
    const srv = await fakeCartesia();
    const stt = cartesiaSttFactory({ apiKey: "k", version: "2026-08-14", model: "ink-2", minVolume: 0.1, maxSilenceS: 0.4, url: srv.url, keyterms: ["Fogline"] })(
      { partial: () => {}, final: () => {} },
      { language: "es", keyterms: ["Stagecraft Rigging Co.", "Stagecraft", "Fogline"] },
    );
    stt.send(new Uint8Array(160));
    await until(() => srv.received.length === 1);
    const q = new URL(srv.received[0]!.url, "ws://x").searchParams;
    expect(q.get("model")).toBe("ink-2");
    expect(q.getAll("keyterm")).toEqual(["Fogline", "Stagecraft Rigging Co.", "Stagecraft"]);
    expect(q.has("language") || q.has("min_volume") || q.has("max_silence_duration_secs")).toBe(false);
    stt.close();
  });

  test("keyterms stay inside Cartesia's limits, first ones kept", () => {
    expect(keytermsWithinLimits(Array.from({ length: 150 }, (_, i) => `term${i}`))).toHaveLength(100);
    const long = Array.from({ length: 30 }, (_, i) => `${"x".repeat(55)}${i}`);
    expect(keytermsWithinLimits(long).join("").length).toBeLessThanOrEqual(1200);
    expect(keytermsWithinLimits([" Fogline ", "Fogline", ""])).toEqual(["Fogline"]);
  });
});

describe("CartesiaTts", () => {
  function tts(url: string) {
    const events: string[] = [];
    const t = new CartesiaTts(
      { apiKey: "k", version: "2026-08-14", model: "sonic-3.6", voiceId: "voice-1", maxBufferDelayMs: 150, url },
      {
        audio: (id, b) => events.push(`audio:${id}:${b.length}`),
        words: (id, w) => events.push(`words:${id}:${w.join(" ")}`),
        done: (id) => events.push(`done:${id}`),
        error: (id) => events.push(`error:${id}`),
      },
    );
    return { t, events };
  }

  test("streams continuations for raw mu-law 8 kHz and routes replies by context", async () => {
    const srv = await fakeCartesia();
    const { t, events } = tts(srv.url);
    t.send("c1", "Hi, ", true);
    t.send("c1", "there.", false);
    await until(() => srv.received.length === 2);
    const first = JSON.parse(srv.received[0]!.text!);
    expect(first).toMatchObject({
      model_id: "sonic-3.6",
      voice: "voice-1",
      transcript: "Hi, ",
      continue: true,
      context_id: "c1",
      add_timestamps: true,
      max_buffer_delay_ms: 150,
      output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
    });
    expect(JSON.parse(srv.received[1]!.text!)).toMatchObject({ transcript: "there.", continue: false });

    const ws = srv.sockets[0]!;
    ws.send(JSON.stringify({ type: "chunk", context_id: "c1", data: Buffer.alloc(400).toString("base64") }));
    ws.send(JSON.stringify({ type: "timestamps", context_id: "c1", word_timestamps: { words: ["Hi,"], start: [0], end: [0.2] } }));
    ws.send(JSON.stringify({ type: "done", context_id: "c1", done: true }));
    await until(() => events.length === 3);
    expect(events).toEqual(["audio:c1:400", "words:c1:Hi,", "done:c1"]);
    t.close();
  });

  test("cancel sends the cancel message and drops audio still in flight", async () => {
    const srv = await fakeCartesia();
    const { t, events } = tts(srv.url);
    t.send("c2", "A long sentence", true);
    await until(() => srv.received.length === 1);
    t.cancel("c2");
    await until(() => srv.received.length === 2);
    expect(JSON.parse(srv.received[1]!.text!)).toEqual({ context_id: "c2", cancel: true });
    srv.sockets[0]!.send(JSON.stringify({ type: "chunk", context_id: "c2", data: "AAAA" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([]);
    t.close();
  });

  test("a dropped socket fails open contexts, and the next send reconnects", async () => {
    const srv = await fakeCartesia();
    const { t, events } = tts(srv.url);
    t.send("c3", "Hello", true);
    await until(() => srv.received.length === 1);
    srv.sockets[0]!.terminate();
    await until(() => events.includes("error:c3"));
    t.send("c4", "Again.", false);
    await until(() => srv.sockets.length === 2 && srv.received.length === 2);
    expect(JSON.parse(srv.received[1]!.text!)).toMatchObject({ context_id: "c4" });
    t.close();
  });
});
