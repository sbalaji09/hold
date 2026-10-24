// Cartesia Sonic text-to-speech over its websocket, one socket per call, one context per say().
// Output is raw pcm_mulaw 8 kHz, which Twilio plays as-is. Text is streamed into the context with
// continue=true so the first words are spoken while Claude is still writing the rest.
import WebSocket from "ws";
import { log } from "./log.js";

export interface TtsSink {
  audio(contextId: string, mulaw: Buffer): void;
  /** Word timestamps (seconds of generated audio), used to estimate what was heard on barge-in. */
  words(contextId: string, words: string[], start: number[]): void;
  done(contextId: string): void;
  /** The context failed (socket dropped or Cartesia error). No more events follow for it. */
  error(contextId: string, err: Error): void;
}

export interface TtsStream {
  /** Append text to a context. more=false ends the context's input. */
  send(contextId: string, transcript: string, more: boolean): void;
  /** Stop a context. Cartesia may still emit audio already generating; callers drop it. */
  cancel(contextId: string): void;
  close(): void;
}

/** language: the call's BCP-47 code ("es"); absent = the factory's default. */
export type TtsFactory = (sink: TtsSink, call?: { language?: string }) => TtsStream;

export interface CartesiaTtsOptions {
  apiKey: string;
  version: string;
  model: string; // e.g. "sonic-3.6"
  voiceId: string;
  maxBufferDelayMs: number;
  language?: string;
  /** A voice per language ("es" -> a native Spanish voice). Absent = voiceId speaks every language. */
  voiceIdByLanguage?: Record<string, string>;
  url?: string;
}

export function cartesiaTtsFactory(opts: CartesiaTtsOptions): TtsFactory {
  return (sink, call) => {
    const language = call?.language ?? opts.language;
    const voiceId = (language && opts.voiceIdByLanguage?.[language]) || opts.voiceId;
    return new CartesiaTts({ ...opts, language, voiceId }, sink);
  };
}

interface ServerMessage {
  type?: string;
  context_id?: string;
  data?: string;
  done?: boolean;
  message?: string;
  title?: string;
  word_timestamps?: { words?: string[]; start?: number[]; end?: number[] };
}

export class CartesiaTts implements TtsStream {
  private ws: WebSocket | null = null;
  private outbox: string[] = [];
  private readonly open = new Set<string>(); // contexts awaiting "done"
  private closed = false;
  private ping: NodeJS.Timeout;

  constructor(
    private readonly opts: CartesiaTtsOptions,
    private readonly sink: TtsSink,
  ) {
    this.connect(); // connect up front so the first say() has no handshake delay
    this.ping = setInterval(() => this.ws?.readyState === WebSocket.OPEN && this.ws.ping(), 15_000);
    this.ping.unref();
  }

  send(contextId: string, transcript: string, more: boolean) {
    this.open.add(contextId);
    this.write({
      model_id: this.opts.model,
      transcript,
      voice: this.opts.voiceId,
      language: this.opts.language ?? "en",
      output_format: { container: "raw", encoding: "pcm_mulaw", sample_rate: 8000 },
      context_id: contextId,
      continue: more,
      max_buffer_delay_ms: this.opts.maxBufferDelayMs,
      add_timestamps: true,
    });
  }

  cancel(contextId: string) {
    if (!this.open.delete(contextId)) return;
    this.write({ context_id: contextId, cancel: true });
  }

  close() {
    this.closed = true;
    clearInterval(this.ping);
    this.ws?.close();
    this.failOpen(new Error("tts closed"));
  }

  private write(msg: object) {
    if (this.closed) return;
    const text = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else {
      this.outbox.push(text);
      if (!this.ws) this.connect();
    }
  }

  private connect() {
    const q = new URLSearchParams({ cartesia_version: this.opts.version });
    const ws = new WebSocket(`${this.opts.url ?? "wss://api.cartesia.ai/tts/websocket"}?${q}`, {
      headers: { "X-API-Key": this.opts.apiKey, "Cartesia-Version": this.opts.version },
    });
    this.ws = ws;
    ws.on("open", () => {
      for (const m of this.outbox) ws.send(m);
      this.outbox = [];
    });
    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("error", (err) => log.warn("tts socket error", { err: err.message }));
    ws.on("close", (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      // Anything queued for the dead socket belonged to contexts we are about to fail.
      this.outbox = [];
      if (!this.closed) log.warn("tts socket closed; will reconnect on next say", { code });
      this.failOpen(new Error(`tts socket closed (${code})`));
    });
  }

  private failOpen(err: Error) {
    const ids = [...this.open];
    this.open.clear();
    for (const id of ids) this.sink.error(id, err);
  }

  private onMessage(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const id = msg.context_id;
    if (!id || !this.open.has(id)) return; // cancelled or unknown: drop late audio
    switch (msg.type) {
      case "chunk":
        if (msg.data) this.sink.audio(id, Buffer.from(msg.data, "base64"));
        break;
      case "timestamps": {
        const w = msg.word_timestamps;
        if (w?.words && w.start) this.sink.words(id, w.words, w.start);
        break;
      }
      case "done":
        this.open.delete(id);
        this.sink.done(id);
        break;
      case "error":
        this.open.delete(id);
        this.sink.error(id, new Error(`${msg.title ?? "tts error"}: ${msg.message ?? ""}`));
        break;
    }
  }
}
