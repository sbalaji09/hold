// HTTP + websocket server for Twilio: TwiML webhooks, status / AMD / recording callbacks, and the
// bidirectional Media Stream (WS /media) that becomes a PhoneTransport.
// Plain node:http; there are five routes and no need for a framework.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { SttFactory } from "./audio/cartesiaStt.js";
import type { TtsFactory } from "./audio/cartesiaTts.js";
import { log } from "./audio/log.js";
import { PhoneTransport, type TwilioOutbound } from "./audio/phoneTransport.js";
import {
  classifyStatus,
  hangupTwiml,
  mediaToken,
  streamTwiml,
  staleBaseUrlHint,
  validTwilioSignature,
  verifyMediaToken,
  type StatusKind,
  type TwilioApi,
} from "./audio/twilio.js";
import type { InboundCallDeps } from "./call/index.js";
import type { LLM } from "./call/llm.js";
import type { AudioTuning } from "./config.js";
import type { VoiceStore } from "./store/types.js";

export interface ServerDeps {
  publicBaseUrl: string;
  authToken: string; // Twilio auth token, for webhook signatures
  secret: string; // VOICE_SERVER_SECRET, for media tokens
  store: VoiceStore;
  llm: LLM;
  twilio: TwilioApi;
  dialer: {
    attachStream(callId: string, callSid: string, transport: PhoneTransport): Promise<void>;
    onStatus(callId: string, callSid: string, kind: StatusKind): Promise<void>;
    languageFor?(callId: string): string | undefined;
    readonly activeCalls: number;
  };
  runInbound: (deps: InboundCallDeps) => Promise<unknown>;
  stt: SttFactory;
  tts: TtsFactory;
  tuning: AudioTuning;
}

const MAX_BODY_BYTES = 64 * 1024;
const START_TIMEOUT_MS = 10_000;

export function createVoiceServer(d: ServerDeps): Server {
  const wsUrl = `${d.publicBaseUrl.replace(/^http/, "ws")}/media`;
  const live = new Set<PhoneTransport>();

  const server = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      log.error("http handler failed", { url: req.url, err: String(err) });
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, { ok: true, liveCalls: live.size, dialerCalls: d.dialer.activeCalls });
    }
    if (req.method !== "POST" || !url.pathname.startsWith("/twilio/")) return res.writeHead(404).end();

    const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const sig = req.headers["x-twilio-signature"];
    if (!validTwilioSignature(d.authToken, d.publicBaseUrl, req.url ?? "", params, typeof sig === "string" ? sig : undefined)) {
      const hint = staleBaseUrlHint(d.publicBaseUrl, req.headers["x-forwarded-host"]?.toString() ?? req.headers.host);
      log.warn("rejected webhook with bad Twilio signature", { path: url.pathname, ...(hint && { hint }) });
      return res.writeHead(403).end();
    }
    const callSid = params.CallSid ?? "";

    if (url.pathname === "/twilio/inbound") {
      // Fogline's own number. Anyone may call; the conversation layer never changes anything.
      const callId = `in_${callSid}`;
      return twiml(
        res,
        streamTwiml(wsUrl, {
          kind: "inbound",
          callId,
          from: params.From ?? "",
          token: mediaToken(d.secret, callId, callSid),
        }),
      );
    }

    const outbound = /^\/twilio\/outbound\/([^/]+)$/.exec(url.pathname);
    if (outbound) {
      const callId = decodeURIComponent(outbound[1]!);
      if (!callSid) return twiml(res, hangupTwiml());
      return twiml(
        res,
        streamTwiml(wsUrl, { kind: "outbound", callId, token: mediaToken(d.secret, callId, callSid) }),
      );
    }

    const callId = url.searchParams.get("callId") ?? "";
    if (url.pathname === "/twilio/status") {
      const kind = classifyStatus(params);
      log.info("twilio status", { callId, callSid, status: params.CallStatus, answeredBy: params.AnsweredBy, kind });
      res.writeHead(204).end();
      if (callId) await d.dialer.onStatus(callId, callSid, kind);
      return;
    }

    if (url.pathname === "/twilio/recording") {
      res.writeHead(204).end(); // answer fast; Twilio times out webhooks after 15 s
      if (params.RecordingStatus !== "completed" || !params.RecordingUrl || !callId) return;
      const audio = await d.twilio.downloadRecording(params.RecordingUrl);
      await d.store.attachRecording(callId, audio, "audio/mpeg");
      log.info("recording attached", { callId, bytes: audio.length, durationS: params.RecordingDuration });
      return;
    }

    res.writeHead(404).end();
  }

  // ---------------------------------------------------------------- media stream

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://local").pathname !== "/media") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onMediaSocket(ws));
  });

  function onMediaSocket(ws: WebSocket) {
    let transport: PhoneTransport | null = null;
    const startTimer = setTimeout(() => ws.close(1008, "no start"), START_TIMEOUT_MS);

    ws.on("message", (data) => {
      let msg: TwilioInbound;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.event === "media") {
        if (transport && msg.media.track !== "outbound") transport.onMedia(Buffer.from(msg.media.payload, "base64"));
      } else if (msg.event === "mark") {
        transport?.onMark(msg.mark.name);
      } else if (msg.event === "stop") {
        transport?.onStreamEnd();
      } else if (msg.event === "start" && !transport) {
        clearTimeout(startTimer);
        transport = onStart(ws, msg.start);
      }
    });
    ws.on("close", () => {
      clearTimeout(startTimer);
      transport?.onStreamEnd();
    });
    ws.on("error", (err) => log.warn("media socket error", { err: err.message }));
  }

  function onStart(ws: WebSocket, start: TwilioStart): PhoneTransport | null {
    const p = start.customParameters ?? {};
    const callId = p.callId ?? "";
    const callSid = start.callSid;
    if (!callId || !verifyMediaToken(d.secret, callId, callSid, p.token)) {
      log.warn("rejected media stream with bad token", { callId, callSid });
      ws.close(1008, "bad token");
      return null;
    }
    const transport = new PhoneTransport({
      callId,
      streamSid: start.streamSid,
      sendToTwilio: (m: TwilioOutbound) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)),
      hangupCall: () => d.twilio.hangup(callSid),
      closeSocket: () => ws.close(),
      stt: d.stt,
      tts: d.tts,
      tuning: d.tuning,
      // Incoming callers are unknown, so the line answers in English.
      language: p.kind === "inbound" ? undefined : d.dialer.languageFor?.(callId),
    });
    live.add(transport);
    void transport.ended.then(() => live.delete(transport));
    log.info("media stream started", { callId, callSid, kind: p.kind });

    // Recording starts with the stream, so transcript ts 0 lines up with recording 0 s.
    d.twilio
      .startRecording(callSid, `${d.publicBaseUrl}/twilio/recording?callId=${encodeURIComponent(callId)}`)
      .catch((err) => log.error("could not start recording", { callId, err: String(err) }));

    const run =
      p.kind === "inbound"
        ? d.runInbound({ store: d.store, transport, call_id: callId, caller_number: p.from ?? "", llm: d.llm })
        : d.dialer.attachStream(callId, callSid, transport);
    run
      .catch((err) => log.error("call run failed", { callId, err: String(err) }))
      .finally(() => void transport.hangup());
    return transport;
  }

  return server;
}

interface TwilioStart {
  streamSid: string;
  callSid: string;
  customParameters?: Record<string, string>;
}

type TwilioInbound =
  | { event: "connected" }
  | { event: "start"; start: TwilioStart }
  | { event: "media"; media: { payload: string; track?: string } }
  | { event: "mark"; mark: { name: string } }
  | { event: "stop" }
  | { event: "dtmf" };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const twiml = (res: ServerResponse, body: string) => res.writeHead(200, { "Content-Type": "text/xml" }).end(body);
const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
