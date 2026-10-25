// Cartesia speech-to-text over its streaming websocket (ink-2 by default; ink-whisper still works).
// Twilio's mu-law 8 kHz frames go straight in (Cartesia accepts pcm_mulaw), so there is no
// transcoding on the hot path. Reconnects on its own if the socket drops mid-call.
// On a real call recording cut at our 300 ms early finalizes, ink-whisper heard "Please deny that to
// anyone" and "Fogline's account status"; ink-2 got both right. ink-2 also takes keyterms (names).
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

/**
 * language: the call's BCP-47 code ("es"); absent = the factory's default (ink-whisper only; ink-2 detects it).
 * keyterms: names and words this call will likely contain ("Stagecraft", "Fogline"), boosted by ink-2.
 */
export type SttFactory = (sink: SttSink, call?: { language?: string; keyterms?: string[] }) => SttStream;

export interface CartesiaSttOptions {
  apiKey: string;
  version: string;
  model: string; // "ink-2" or "ink-whisper"
  minVolume: number; // ink-whisper only
  maxSilenceS: number; // ink-whisper only
  language?: string; // ink-whisper only
  keyterms?: string[]; // ink-2 / ink-preview only
  url?: string; // override for tests
}

const MAX_BUFFER_BYTES = 8000 * 2; // keep up to 2 s of audio while (re)connecting

export function cartesiaSttFactory(opts: CartesiaSttOptions): SttFactory {
  return (sink, call) =>
    new CartesiaStt({ ...opts, language: call?.language ?? opts.language, keyterms: [...(opts.keyterms ?? []), ...(call?.keyterms ?? [])] }, sink);
}

/** Cartesia's keyterm limits: up to 100 terms, 1200 characters in all. Duplicates dropped, first ones kept. */
export function keytermsWithinLimits(terms: string[]): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const t of new Set(terms.map((x) => x.trim()).filter(Boolean))) {
    if (out.length === 100 || chars + t.length > 1200) break;
    out.push(t);
    chars += t.length;
  }
  return out;
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
    const q = new URLSearchParams({ model: this.opts.model, encoding: "pcm_mulaw", sample_rate: "8000", cartesia_version: this.opts.version });
    if (this.opts.model === "ink-whisper") {
      q.set("language", this.opts.language ?? "en");
      q.set("min_volume", String(this.opts.minVolume));
      q.set("max_silence_duration_secs", String(this.opts.maxSilenceS));
    } else {
      for (const t of keytermsWithinLimits(this.opts.keyterms ?? [])) q.append("keyterm", t);
    }
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
