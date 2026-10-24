// Cartesia speech-to-text over its streaming websocket (ink-whisper).
// Twilio's mu-law 8 kHz frames go straight in (Cartesia accepts pcm_mulaw), so there is no
// transcoding on the hot path. Reconnects on its own if the socket drops mid-call.
import WebSocket from "ws";
import { log } from "./log.js";

export interface SttSink {
  /** Interim hypothesis for the segment in progress (replaces the previous partial). */
  partial(text: string): void;
  /** Finalized text delta. Concatenate deltas verbatim; do not trim or add spaces. */
  final(text: string): void;
}

export interface SttStream {
  send(mulaw: Uint8Array): void;
  /** Ask for the transcript of everything buffered so far (we call it on local end-of-speech). */
  finalize(): void;
  close(): void;
}

/** language: the call's BCP-47 code ("es"); absent = the factory's default. */
export type SttFactory = (sink: SttSink, call?: { language?: string }) => SttStream;

export interface CartesiaSttOptions {
  apiKey: string;
  version: string;
  model: string; // "ink-whisper"
  minVolume: number;
  maxSilenceS: number;
  language?: string;
  url?: string; // override for tests
}

const MAX_BUFFER_BYTES = 8000 * 2; // keep up to 2 s of audio while (re)connecting

export function cartesiaSttFactory(opts: CartesiaSttOptions): SttFactory {
  return (sink, call) => new CartesiaStt({ ...opts, language: call?.language ?? opts.language }, sink);
}

export class CartesiaStt implements SttStream {
  private ws: WebSocket | null = null;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private closed = false;
  private failures = 0;

  constructor(
    private readonly opts: CartesiaSttOptions,
    private readonly sink: SttSink,
  ) {
    this.connect();
  }

  send(mulaw: Uint8Array) {
    if (this.closed) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(mulaw);
      return;
    }
    this.pending.push(mulaw);
    this.pendingBytes += mulaw.length;
    while (this.pendingBytes > MAX_BUFFER_BYTES) this.pendingBytes -= this.pending.shift()!.length;
  }

  finalize() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("finalize");
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send("close");
      setTimeout(() => ws.terminate(), 1000).unref();
    } else ws?.terminate();
  }

  private connect() {
    const q = new URLSearchParams({
      model: this.opts.model,
      language: this.opts.language ?? "en",
      encoding: "pcm_mulaw",
      sample_rate: "8000",
      cartesia_version: this.opts.version,
      min_volume: String(this.opts.minVolume),
      max_silence_duration_secs: String(this.opts.maxSilenceS),
    });
    const ws = new WebSocket(`${this.opts.url ?? "wss://api.cartesia.ai/stt/websocket"}?${q}`, {
      headers: { "X-API-Key": this.opts.apiKey, "Cartesia-Version": this.opts.version },
    });
    this.ws = ws;
    ws.on("open", () => {
      this.failures = 0;
      for (const chunk of this.pending) ws.send(chunk);
      this.pending = [];
      this.pendingBytes = 0;
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let msg: { type?: string; text?: string; is_final?: boolean; message?: string; title?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "transcript" && typeof msg.text === "string") {
        if (msg.is_final) this.sink.final(msg.text);
        else this.sink.partial(msg.text);
      } else if (msg.type === "error") {
        log.warn("stt error", { title: msg.title, message: msg.message });
      }
    });
    ws.on("error", (err) => log.warn("stt socket error", { err: err.message }));
    ws.on("close", (code) => {
      if (this.closed || this.ws !== ws) return;
      this.ws = null;
      this.failures++;
      const delay = Math.min(2000, 100 * 2 ** this.failures);
      log.warn("stt socket closed, reconnecting", { code, delay });
      setTimeout(() => !this.closed && this.connect(), delay).unref();
    });
  }
}
