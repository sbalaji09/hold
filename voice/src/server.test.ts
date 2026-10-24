import type { AddressInfo } from "node:net";
import twilio from "twilio";
import { afterEach, describe, expect, test, vi } from "vitest";
import WebSocket from "ws";
import type { PhoneTransport } from "./audio/phoneTransport.js";
import { mediaToken, type TwilioApi } from "./audio/twilio.js";
import type { LLM } from "./call/llm.js";
import { DEFAULT_TUNING } from "./config.js";
import { createVoiceServer, type ServerDeps } from "./server.js";
import { MemoryStore } from "./store/memoryStore.js";

const BASE = "https://abc.ngrok-free.app";
const AUTH = "auth_token";
const SECRET = "voice_server_secret_for_tests";

function setup() {
  const store = new MemoryStore();
  const tw = {
    dial: vi.fn(),
    hangup: vi.fn(async () => undefined),
    redirect: vi.fn(),
    startRecording: vi.fn(async () => undefined),
    downloadRecording: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } satisfies TwilioApi;
  const streams: { callId: string; callSid: string; transport: PhoneTransport }[] = [];
  const dialer = {
    activeCalls: 0,
    attachStream: vi.fn(async (callId: string, callSid: string, transport: PhoneTransport) => {
      streams.push({ callId, callSid, transport });
      await transport.ended;
    }),
    onStatus: vi.fn(async () => undefined),
  };
  const runInbound = vi.fn(async (deps: Parameters<ServerDeps["runInbound"]>[0]) => deps.transport.ended);
  const stt = { frames: 0 };
  const server = createVoiceServer({
    publicBaseUrl: BASE,
    authToken: AUTH,
    secret: SECRET,
    store,
    llm: {} as LLM,
    twilio: tw,
    dialer,
    runInbound,
    stt: () => ({ send: () => void stt.frames++, finalize: () => undefined, close: () => undefined }),
    tts: () => ({ send: () => undefined, cancel: () => undefined, close: () => undefined }),
    tuning: DEFAULT_TUNING,
  });
  return new Promise<{
    port: number;
    store: MemoryStore;
    tw: typeof tw;
    dialer: typeof dialer;
    runInbound: typeof runInbound;
    streams: typeof streams;
    stt: typeof stt;
    close: () => void;
  }>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        store,
        tw,
        dialer,
        runInbound,
        streams,
        stt,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      }),
    ),
  );
}

async function post(port: number, path: string, params: Record<string, string>, sign = true) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (sign) headers["X-Twilio-Signature"] = twilio.getExpectedTwilioSignature(AUTH, BASE + path, params);
  return fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers, body: new URLSearchParams(params) });
}

function openMedia(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/media`);
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  return new Promise<{ ws: WebSocket; closed: Promise<number> }>((r) => ws.on("open", () => r({ ws, closed })));
}

const start = (callSid: string, params: Record<string, string>) =>
  JSON.stringify({ event: "start", streamSid: "MZ1", start: { streamSid: "MZ1", callSid, customParameters: params } });

let h: Awaited<ReturnType<typeof setup>> | null = null;
afterEach(() => {
  h?.close();
  h?.store.dispose();
  h = null;
});

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe("webhooks", () => {
  test("health check", async () => {
    h = await setup();
    const res = await fetch(`http://127.0.0.1:${h.port}/healthz`);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test("rejects unsigned and mis-signed webhooks", async () => {
    h = await setup();
    expect((await post(h.port, "/twilio/inbound", { CallSid: "CA1" }, false)).status).toBe(403);
    const res = await fetch(`http://127.0.0.1:${h.port}/twilio/inbound`, {
      method: "POST",
      headers: { "X-Twilio-Signature": "bogus", "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallSid=CA1",
    });
    expect(res.status).toBe(403);
  });

  test("inbound returns a Connect Stream with a token bound to the call", async () => {
    h = await setup();
    const res = await post(h.port, "/twilio/inbound", { CallSid: "CA7", From: "+14155550111" });
    const xml = await res.text();
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(xml).toContain('<Stream url="wss://abc.ngrok-free.app/media">');
    expect(xml).toContain('<Parameter name="kind" value="inbound"/>');
    expect(xml).toContain('<Parameter name="callId" value="in_CA7"/>');
    expect(xml).toContain('<Parameter name="from" value="+14155550111"/>');
    expect(xml).toMatch(/<Parameter name="token" value="\d+\.[\w-]+"\/>/);
  });

  test("outbound TwiML carries the call id", async () => {
    h = await setup();
    const xml = await (await post(h.port, "/twilio/outbound/call_1", { CallSid: "CA1" })).text();
    expect(xml).toContain('<Parameter name="kind" value="outbound"/>');
    expect(xml).toContain('<Parameter name="callId" value="call_1"/>');
  });

  test("status callbacks are classified and routed to the dialer", async () => {
    h = await setup();
    expect((await post(h.port, "/twilio/status?callId=call_1", { CallSid: "CA1", CallStatus: "busy" })).status).toBe(204);
    await post(h.port, "/twilio/status?callId=call_1", { CallSid: "CA1", AnsweredBy: "machine_start" });
    await until(() => h!.dialer.onStatus.mock.calls.length === 2);
    expect(h.dialer.onStatus.mock.calls).toEqual([
      ["call_1", "CA1", "no_answer"],
      ["call_1", "CA1", "machine"],
    ]);
  });

  test("a completed recording is downloaded and attached", async () => {
    h = await setup();
    h.store.addRequest({
      call_id: "call_1",
      bill_id: "b",
      supplier_id: "s",
      to_number: "+14155550123",
      number_source: "on_file",
      reason: [],
    });
    await post(h.port, "/twilio/recording?callId=call_1", {
      CallSid: "CA1",
      RecordingStatus: "completed",
      RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1",
      RecordingSid: "RE1",
    });
    await until(() => Boolean(h!.store.requests.get("call_1")?.recording_url));
    expect(h.tw.downloadRecording).toHaveBeenCalledWith("https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1");
  });
});

describe("media stream", () => {
  test("a valid outbound stream becomes a transport, starts recording and feeds audio", async () => {
    h = await setup();
    const { ws } = await openMedia(h.port);
    ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
    ws.send(start("CA1", { kind: "outbound", callId: "call_1", token: mediaToken(SECRET, "call_1", "CA1") }));
    await until(() => h!.streams.length === 1);
    expect(h.streams[0]).toMatchObject({ callId: "call_1", callSid: "CA1" });
    expect(h.tw.startRecording).toHaveBeenCalledWith("CA1", `${BASE}/twilio/recording?callId=call_1`);

    const payload = Buffer.alloc(160, 0xff).toString("base64");
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload } }));
    await until(() => h!.stt.frames === 5);

    ws.send(JSON.stringify({ event: "stop" }));
    expect(await h.streams[0]!.transport.ended).toBe("dropped");
    ws.close();
  });

  test("an inbound stream runs the inbound call with the caller's number", async () => {
    h = await setup();
    const { ws } = await openMedia(h.port);
    ws.send(start("CA7", { kind: "inbound", callId: "in_CA7", from: "+14155550111", token: mediaToken(SECRET, "in_CA7", "CA7") }));
    await until(() => h!.runInbound.mock.calls.length === 1);
    expect(h.runInbound.mock.calls[0]![0]).toMatchObject({ call_id: "in_CA7", caller_number: "+14155550111" });
    ws.close();
  });

  test("a stream with a bad token is closed", async () => {
    h = await setup();
    const { ws, closed } = await openMedia(h.port);
    ws.send(start("CA2", { kind: "outbound", callId: "call_1", token: mediaToken(SECRET, "call_1", "CA1") }));
    expect(await closed).toBe(1008);
    expect(h.streams).toHaveLength(0);
    expect(h.tw.startRecording).not.toHaveBeenCalled();
  });
});
