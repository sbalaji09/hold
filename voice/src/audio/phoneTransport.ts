// CallTransport over a live phone call: Twilio Media Streams <-> Cartesia STT / Sonic TTS.
//
// Turn taking:
//   - The energy VAD and ink-whisper both watch the caller. When the VAD hears end of speech we
//     send STT "finalize" right away instead of waiting for server-side silence detection.
//   - A turn ends endOfTurnMs after the last final transcript, unless the caller is still talking.
// Barge-in (while say() is playing):
//   - VAD onset (sustained speech) or an STT partial with enough words cuts playback at once:
//     Twilio "clear" drops buffered audio, the Cartesia context is cancelled (late chunks dropped),
//     and say() resolves interrupted=true with the text the caller most likely heard, estimated
//     from Twilio playback marks and Cartesia word timestamps.
// Timing: t0 is the Media Stream start, which is when recording starts, so ts 0 = recording 0 s.
import { randomUUID } from "node:crypto";
import type { CallTransport, EndReason, SayOptions, SayResult, Utterance } from "../call/transport.js";
import type { AudioTuning } from "../config.js";
import type { SttFactory, SttStream } from "./cartesiaStt.js";
import type { TtsFactory, TtsStream } from "./cartesiaTts.js";
import { log } from "./log.js";
import { SAMPLE_RATE } from "./mulaw.js";
import { EnergyVad } from "./vad.js";

/** Messages we send to Twilio on the media websocket. */
export type TwilioOutbound =
  | { event: "media"; streamSid: string; media: { payload: string } }
  | { event: "mark"; streamSid: string; mark: { name: string } }
  | { event: "clear"; streamSid: string };

export interface PhoneTransportOptions {
  callId: string;
  streamSid: string;
  /** Send one JSON message to Twilio over the media websocket. */
  sendToTwilio: (msg: TwilioOutbound) => void;
  /** End the phone call (Twilio REST). Errors are logged, never thrown at the call layer. */
  hangupCall: () => Promise<void>;
  /** Close the media websocket. */
  closeSocket: () => void;
  stt: SttFactory;
  tts: TtsFactory;
  tuning: AudioTuning;
  now?: () => number;
}

const BYTES_PER_MS = SAMPLE_RATE / 1000;
/** If a context goes quiet this long between text chunks, Cartesia may have expired it (1 s rule). */
const CONTEXT_IDLE_MS = 700;
/** Extra wait for Twilio's final playback mark before assuming the audio played. */
const MARK_GRACE_MS = 1500;
/** Never hold a turn open longer than this after its first final words, even in constant noise. */
const MAX_TURN_HOLD_MS = 2000;

interface ActiveSay {
  id: string;
  text: string; // everything handed to TTS so far
  ctx: string; // current Cartesia context id
  ctxText: string; // text sent on the current context
  ctxTextBase: number; // offset of ctxText within text
  ctxAudioBase: number; // say-level byte offset where this context's audio starts
  ctxMatched: number; // chars of ctxText covered by word timestamps
  ctxLastAudioAt: number;
  ctxDone: boolean;
  inputDone: boolean;
  retries: number;
  words: { end: number; atByte: number }[]; // end = char offset in text after the word
  sentBytes: number;
  playedBytes: number;
  playedAt: number;
  firstAudioAt: number | null;
  calledAt: number;
  opening: boolean; // see SayOptions.opening: no VAD barge-in, needs more transcribed words
  markTimer?: NodeJS.Timeout;
  resolve: (r: SayResult) => void;
}

interface PendingListen {
  resolve: (u: Utterance | null) => void;
  timer: NodeJS.Timeout;
  timeoutMs: number;
  since: number;
}

export class PhoneTransport implements CallTransport {
  readonly ended: Promise<EndReason>;
  private endReason: EndReason | null = null;
  private resolveEnded!: (r: EndReason) => void;
  private readonly t0: number;
  private readonly now: () => number;
  private readonly vad: EnergyVad;
  private readonly stt: SttStream;
  private readonly tts: TtsStream;

  // Listening
  private readonly queue: Utterance[] = [];
  private listener: PendingListen | null = null;
  private turnText = "";
  private partialText = "";
  private turnStartS: number | null = null;
  private turnEndS = 0;
  private firstFinalAt = 0;
  private eotTimer: NodeJS.Timeout | null = null;
  private lastActivityAt = 0;
  private lastTurnCommittedAt: number | null = null;
  private lastTurnEndS = 0;

  // Speaking
  private active: ActiveSay | null = null;
  private sayChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: PhoneTransportOptions) {
    this.now = o.now ?? Date.now;
    this.t0 = this.now();
    this.ended = new Promise((r) => (this.resolveEnded = r));
    this.vad = new EnergyVad({
      minSpeechMs: o.tuning.vadMinSpeechMs,
      marginDb: o.tuning.vadMarginDb,
      minDbfs: o.tuning.vadMinDbfs,
      hangoverMs: o.tuning.finalizeSilenceMs,
    });
    this.stt = o.stt({ partial: (t) => this.onPartial(t), final: (t) => this.onFinal(t) });
    this.tts = o.tts({
      audio: (id, b) => this.onTtsAudio(id, b),
      words: (id, w, s) => this.onTtsWords(id, w, s),
      done: (id) => this.onTtsDone(id),
      error: (id, e) => this.onTtsError(id, e),
    });
  }

  elapsed(): number {
    return (this.now() - this.t0) / 1000;
  }

  // ---------------------------------------------------------------- Twilio input

  /** Inbound caller audio (mu-law 8 kHz), one Twilio media frame. */
  onMedia(frame: Uint8Array) {
    if (this.endReason) return;
    this.stt.send(frame);
    const ev = this.vad.push(frame);
    if (ev === "onset") {
      this.lastActivityAt = this.now();
      this.turnStartS ??= Math.max(0, this.elapsed() - this.o.tuning.vadMinSpeechMs / 1000);
      // A pickup "Hello?" over the opening line is voice too; there only the transcript decides.
      if (this.active && !this.active.opening) this.bargeIn("vad");
    } else if (ev === "offset") {
      this.turnEndS = Math.max(0, this.elapsed() - this.o.tuning.finalizeSilenceMs / 1000);
      this.stt.finalize();
      if (this.turnText.trim()) this.armEot();
    }
  }

  /** Twilio echoed a mark: audio up to that byte of that say has finished playing. */
  onMark(name: string) {
    const [sayId, bytes] = name.split(":");
    const a = this.active;
    if (!a || a.id !== sayId) return; // marks returned by "clear" for a cut say
    a.playedBytes = Math.max(a.playedBytes, Number(bytes));
    a.playedAt = this.now();
    this.maybeFinishSay(a);
  }

  /** Twilio sent "stop" or the media socket closed. */
  onStreamEnd() {
    this.finish("dropped");
  }

  /** Call before redirecting the call to Maya, so the stream stop that follows reads as a takeover. */
  markTakeover() {
    this.finish("takeover");
  }

  // ---------------------------------------------------------------- CallTransport

  say(text: string | AsyncIterable<string>, opts: SayOptions = {}): Promise<SayResult> {
    const run = this.sayChain.then(() => this.sayNow(text, opts));
    this.sayChain = run.catch(() => undefined);
    return run;
  }

  listen(opts: { timeoutMs: number }): Promise<Utterance | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.endReason) return Promise.resolve(null);
    this.listener?.resolve(null); // one listener at a time
    return new Promise((resolve) => {
      const since = this.now();
      const l: PendingListen = { resolve, timeoutMs: opts.timeoutMs, since, timer: null as never };
      const check = () => {
        if (this.listener !== l) return;
        const quietSince = Math.max(l.since, this.lastActivityAt);
        const left = quietSince + l.timeoutMs - this.now();
        if (left > 0 || this.turnText.trim()) {
          l.timer = setTimeout(check, Math.max(left, 50));
          return;
        }
        this.listener = null;
        resolve(null);
      };
      l.timer = setTimeout(check, opts.timeoutMs);
      this.listener = l;
    });
  }

  async hangup(): Promise<void> {
    if (this.endReason) return;
    this.finish("hangup");
    try {
      await this.o.hangupCall();
    } catch (err) {
      log.warn("hangup via REST failed; closing stream instead", { callId: this.o.callId, err: String(err) });
    }
    this.o.closeSocket();
  }

  // ---------------------------------------------------------------- listening internals

  private onPartial(text: string) {
    if (!text.trim()) return;
    this.partialText = text;
    this.lastActivityAt = this.now();
    this.turnStartS ??= this.elapsed();
    // No clearEot here: the end-of-turn timer itself holds the turn while partials keep coming,
    // and still closes it after MAX_TURN_HOLD_MS if a partial never turns final.
    if (this.active && wordCount(text) >= this.bargeInWords(this.active)) this.bargeIn("stt");
  }

  private onFinal(delta: string) {
    if (!delta) return;
    this.turnText += delta;
    this.partialText = "";
    if (!this.turnText.trim()) return;
    this.lastActivityAt = this.now();
    this.turnStartS ??= this.elapsed();
    if (!this.firstFinalAt) this.firstFinalAt = this.now();
    if (!this.vad.speaking) this.turnEndS = this.elapsed();
    if (this.active && wordCount(this.turnText) >= this.bargeInWords(this.active)) this.bargeIn("stt");
    this.armEot();
  }

  private bargeInWords(a: ActiveSay): number {
    return a.opening ? this.o.tuning.openingBargeInMinWords : this.o.tuning.bargeInMinWords;
  }

  private armEot() {
    this.clearEot();
    this.eotTimer = setTimeout(() => {
      this.eotTimer = null;
      const held = this.now() - this.firstFinalAt;
      if ((this.vad.speaking || this.partialText) && held < MAX_TURN_HOLD_MS) {
        this.armEot(); // still talking: keep the turn open
        return;
      }
      this.commitTurn();
    }, this.o.tuning.endOfTurnMs);
  }

  private clearEot() {
    if (this.eotTimer) clearTimeout(this.eotTimer);
    this.eotTimer = null;
  }

  private commitTurn() {
    const text = this.turnText.trim().replace(/\s+/g, " ");
    const now = this.elapsed();
    const start_s = this.turnStartS ?? now;
    const end_s = Math.min(now, Math.max(this.turnEndS, start_s));
    this.turnText = "";
    this.partialText = "";
    this.turnStartS = null;
    this.firstFinalAt = 0;
    if (!text || this.endReason) return;
    this.lastTurnCommittedAt = this.now();
    this.lastTurnEndS = end_s;
    const u: Utterance = { text, start_s, end_s };
    log.info("turn heard", {
      callId: this.o.callId,
      text,
      endOfSpeechToCommitMs: Math.round((now - end_s) * 1000),
    });
    const l = this.listener;
    if (l) {
      this.listener = null;
      clearTimeout(l.timer);
      l.resolve(u);
    } else this.queue.push(u);
  }

  // ---------------------------------------------------------------- speaking internals

  private async sayNow(input: string | AsyncIterable<string>, opts: SayOptions): Promise<SayResult> {
    const startS = this.elapsed();
    if (this.endReason) return { interrupted: true, spokenText: "", start_s: startS, end_s: startS };
    const a: ActiveSay = {
      id: randomUUID().slice(0, 8),
      text: "",
      ctx: randomUUID(),
      ctxText: "",
      ctxTextBase: 0,
      ctxAudioBase: 0,
      ctxMatched: 0,
      ctxLastAudioAt: 0,
      ctxDone: false,
      inputDone: false,
      retries: 0,
      words: [],
      sentBytes: 0,
      playedBytes: 0,
      playedAt: 0,
      firstAudioAt: null,
      calledAt: this.now(),
      opening: opts.opening ?? false,
      resolve: () => undefined,
    };
    const done = new Promise<SayResult>((r) => (a.resolve = r));
    this.active = a;

    if (typeof input === "string") {
      this.pushText(a, input, false);
    } else {
      let buf = "";
      try {
        for await (const chunk of input) {
          if (this.active !== a) break; // interrupted or ended: stop pulling Claude tokens
          buf += chunk;
          // Send up to the last whitespace so words are never split across continuations.
          const cut = Math.max(buf.lastIndexOf(" "), buf.lastIndexOf("\n"));
          if (cut >= 0) {
            this.pushText(a, buf.slice(0, cut + 1), true);
            buf = buf.slice(cut + 1);
          }
        }
      } catch (err) {
        log.error("say(): text stream failed; speaking what we have", { callId: this.o.callId, err: String(err) });
      }
      if (this.active === a) this.pushText(a, buf, false);
    }
    return done;
  }

  private pushText(a: ActiveSay, text: string, more: boolean) {
    if (this.active !== a) return;
    // Cartesia expires a context ~1 s after its last audio. If Claude paused that long, start a
    // fresh context for the rest instead of writing into a dead one.
    if (a.ctxText && !a.ctxDone && a.ctxLastAudioAt && this.now() - a.ctxLastAudioAt > CONTEXT_IDLE_MS) {
      this.newContext(a);
    }
    if (a.ctxDone && (text.trim() || !more)) this.newContext(a);
    a.text += text;
    a.ctxText += text;
    a.inputDone = !more;
    if (!text && more) return;
    if (!more && !a.ctxText.trim()) {
      // Nothing to say on this context (e.g. empty string): close it without generating.
      a.ctxDone = true;
      this.maybeFinishSay(a);
      return;
    }
    this.tts.send(a.ctx, text, more);
  }

  private newContext(a: ActiveSay) {
    this.tts.cancel(a.ctx);
    a.ctx = randomUUID();
    a.ctxTextBase = a.text.length;
    a.ctxText = "";
    a.ctxAudioBase = a.sentBytes;
    a.ctxMatched = 0;
    a.ctxLastAudioAt = 0;
    a.ctxDone = false;
  }

  private onTtsAudio(ctx: string, mulaw: Buffer) {
    const a = this.active;
    if (!a || a.ctx !== ctx || this.endReason) return;
    const now = this.now();
    if (a.firstAudioAt === null) {
      a.firstAudioAt = now;
      this.logLatency(a, now);
    }
    a.ctxLastAudioAt = now;
    this.o.sendToTwilio({ event: "media", streamSid: this.o.streamSid, media: { payload: mulaw.toString("base64") } });
    a.sentBytes += mulaw.length;
    this.o.sendToTwilio({ event: "mark", streamSid: this.o.streamSid, mark: { name: `${a.id}:${a.sentBytes}` } });
  }

  private onTtsWords(ctx: string, words: string[], starts: number[]) {
    const a = this.active;
    if (!a || a.ctx !== ctx) return;
    const lower = a.ctxText.toLowerCase();
    words.forEach((w, i) => {
      const at = lower.indexOf(w.toLowerCase(), a.ctxMatched);
      if (at < 0) return; // normalised word we cannot place; skip it
      a.ctxMatched = at + w.length;
      a.words.push({
        end: a.ctxTextBase + a.ctxMatched,
        atByte: a.ctxAudioBase + Math.round((starts[i] ?? 0) * SAMPLE_RATE),
      });
    });
  }

  private onTtsDone(ctx: string) {
    const a = this.active;
    if (!a || a.ctx !== ctx) return;
    a.ctxDone = true;
    this.maybeFinishSay(a);
  }

  private onTtsError(ctx: string, err: Error) {
    const a = this.active;
    if (!a || a.ctx !== ctx) return;
    // Retry what Cartesia had not generated yet on a fresh context (the socket reconnects).
    const remainder = a.ctxText.slice(a.ctxMatched);
    log.warn("tts context failed", { callId: this.o.callId, err: err.message, retry: a.retries < 2 });
    a.ctxDone = true;
    if (a.retries >= 2 || !remainder.trim()) {
      this.maybeFinishSay(a);
      return;
    }
    a.retries++;
    const inputDone = a.inputDone;
    a.text = a.text.slice(0, a.ctxTextBase + a.ctxMatched);
    this.newContext(a);
    this.pushText(a, remainder, !inputDone);
  }

  private maybeFinishSay(a: ActiveSay) {
    if (this.active !== a || !a.inputDone || !a.ctxDone) return;
    if (a.playedBytes < a.sentBytes) {
      // Waiting for Twilio's last mark. If it never comes, finish once the audio must have played.
      a.markTimer ??= setTimeout(
        () => {
          a.playedBytes = a.sentBytes;
          this.maybeFinishSay(a);
        },
        (a.sentBytes - a.playedBytes) / BYTES_PER_MS + MARK_GRACE_MS,
      );
      return;
    }
    if (a.markTimer) clearTimeout(a.markTimer);
    this.active = null;
    const end = this.elapsed();
    a.resolve({
      interrupted: false,
      spokenText: a.text,
      start_s: a.firstAudioAt === null ? end : (a.firstAudioAt - this.t0) / 1000,
      end_s: end,
    });
  }

  private bargeIn(trigger: "vad" | "stt") {
    const a = this.active;
    if (!a) return;
    this.o.sendToTwilio({ event: "clear", streamSid: this.o.streamSid });
    this.cutSay(a);
    log.info("barge-in", { callId: this.o.callId, trigger, atS: this.elapsed() });
  }

  /** Stop a say now and resolve it with our best guess of what the caller heard. */
  private cutSay(a: ActiveSay) {
    this.active = null;
    if (a.markTimer) clearTimeout(a.markTimer);
    this.tts.cancel(a.ctx);
    const now = this.now();
    const played =
      a.firstAudioAt === null
        ? 0
        : Math.min(
            a.sentBytes,
            a.playedAt
              ? a.playedBytes + (now - a.playedAt) * BYTES_PER_MS
              : (now - a.firstAudioAt) * BYTES_PER_MS,
          );
    a.resolve({
      interrupted: true,
      spokenText: heardText(a, played),
      start_s: a.firstAudioAt === null ? this.elapsed() : (a.firstAudioAt - this.t0) / 1000,
      end_s: this.elapsed(),
    });
  }

  private logLatency(a: ActiveSay, firstAudioAt: number) {
    const fields: Record<string, unknown> = {
      callId: this.o.callId,
      ttsFirstAudioMs: firstAudioAt - a.calledAt,
    };
    if (this.lastTurnCommittedAt !== null) {
      // Turn gap the caller feels = end of their speech -> our first audio. Twilio adds ~100 ms more.
      fields.thinkMs = a.calledAt - this.lastTurnCommittedAt;
      fields.turnGapMs = Math.round(firstAudioAt - this.t0 - this.lastTurnEndS * 1000);
      this.lastTurnCommittedAt = null;
    }
    log.info("first audio", fields);
  }

  // ---------------------------------------------------------------- ending

  private finish(reason: EndReason) {
    if (this.endReason) return;
    this.endReason = reason;
    this.clearEot();
    if (this.active) this.cutSay(this.active);
    const l = this.listener;
    if (l) {
      this.listener = null;
      clearTimeout(l.timer);
      l.resolve(null);
    }
    this.stt.close();
    this.tts.close();
    log.info("call ended", { callId: this.o.callId, reason, elapsedS: Math.round(this.elapsed()) });
    this.resolveEnded(reason);
  }
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Text up to the last word whose audio had started playing by `playedBytes`. */
export function heardText(a: Pick<ActiveSay, "text" | "words">, playedBytes: number): string {
  if (playedBytes <= 0) return "";
  if (a.words.length === 0) {
    // No timestamps: assume ~14 characters per second of speech, cut at a word boundary.
    const chars = Math.round((playedBytes / SAMPLE_RATE) * 14);
    if (chars >= a.text.length) return a.text;
    const cut = a.text.lastIndexOf(" ", chars);
    return cut > 0 ? a.text.slice(0, cut) : "";
  }
  let end = 0;
  for (const w of a.words) if (w.atByte < playedBytes) end = w.end;
  return a.text.slice(0, end);
}
