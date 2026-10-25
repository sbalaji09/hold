// One live conversation over a CallTransport: speaks and listens, keeps the transcript, writes
// segment events as each turn happens, and notices the end of the call (hangup, drop, takeover).
import type { CallEvent, Speaker } from "../../../shared/contract.js";
import type { VoiceStore } from "../store/types.js";
import type { ChatMessage } from "./llm.js";
import { classifyTurn } from "./policy.js";
import type { CallTransport, EndReason, SayOptions, SayResult, Utterance } from "./transport.js";

/** How long after being cut off hold waits for words before deciding nobody really spoke. */
export const FALSE_BARGE_IN_MS = 1500;

/**
 * Lets say() read a streamed reply and, if it's cut off, collect the rest the transport never took.
 * Stopping early doesn't close the source (no return() on it), so the rest is still there.
 */
function keepRest(source: AsyncIterable<string>) {
  const it = source[Symbol.asyncIterator]();
  let taken = "";
  return {
    view: {
      async *[Symbol.asyncIterator]() {
        for (let n = await it.next(); !n.done; n = await it.next()) {
          taken += n.value;
          yield n.value;
        }
      },
    },
    taken: () => taken,
    async rest(): Promise<string> {
      let out = "";
      try {
        for (let n = await it.next(); !n.done; n = await it.next()) out += n.value;
      } catch (err) {
        console.error("[call] reading the rest of a cut-off reply failed:", err);
      }
      return out;
    },
  };
}

/**
 * What to say after being cut off: from the start of the sentence that was cut, to the end. Null
 * if nothing is left, or the played text isn't the start of the full text (can't tell where we were).
 */
export function resumeFrom(full: string, spoken: string): string | null {
  const said = spoken.trimEnd();
  if (!full.startsWith(said) || said.length >= full.trimEnd().length) return null;
  let from = 0;
  for (const m of said.matchAll(/[.!?]+["')\]]*(?:\s+|$)/g)) from = m.index + m[0].length;
  const rest = full.slice(from).trim();
  return rest || null;
}

export interface Turn {
  speaker: Speaker;
  text: string;
  start_s: number;
  end_s: number;
}

export class CallSession {
  readonly turns: Turn[] = [];
  private reason: EndReason | null = null;
  /** When the opening line finished playing in full; greetings said over it are not turns. */
  private openingEndS: number | null = null;
  /** Words that started before this were said while hold was busy (waiting on a person): transcript only. */
  private ignoreBeforeS: number | null = null;
  /** Words that cut hold off, heard while deciding whether to carry on; hear() returns them first. */
  private readonly heardEarly: Utterance[] = [];
  private stop!: () => void;
  private readonly stopped = new Promise<null>((resolve) => (this.stop = () => resolve(null)));

  constructor(
    private readonly store: VoiceStore,
    readonly transport: CallTransport,
    readonly call_id: string,
    private readonly other: Exclude<Speaker, "callback">,
  ) {
    transport.ended.then(
      (r) => this.end(r),
      () => this.end("dropped"),
    );
  }

  /** Why the call ended, or null while it is live. */
  get endReason(): EndReason | null {
    return this.reason;
  }

  get over(): boolean {
    return this.reason !== null;
  }

  /** Mark the call over. The first reason wins (a drop stays a drop if the approver presses takeover later). */
  end(reason: EndReason): void {
    this.reason ??= reason;
    this.stop();
  }

  /**
   * Speak; resolves null if the call ends first. Writes a segment with what was actually played.
   * Cut off with no words after it (echo, a cough, a noisy room), hold picks up again from the start
   * of the sentence it was in, so a reply is never left half-said. Cut off by words, those are
   * answered next, as before. The opening line has its own retry (greetFully, discloseFully).
   */
  async say(text: string | AsyncIterable<string>, opts?: SayOptions): Promise<SayResult | null> {
    if (this.over) return null;
    const stream = typeof text === "string" ? null : keepRest(text);
    const r = await this.sayOnce(stream ? stream.view : text, opts);
    if (!r?.interrupted || opts?.opening) return r;
    const u = await this.hearOnce(FALSE_BARGE_IN_MS);
    if (u) {
      this.heardEarly.push(u);
      return r;
    }
    if (this.over) return r;
    const full = stream ? stream.taken() + (await stream.rest()) : text;
    const rest = resumeFrom(full as string, r.spokenText);
    if (!rest) return r;
    console.warn(`[call ${this.call_id}] cut off with nothing said after; resuming: "${rest.slice(0, 60)}"`);
    return (await this.sayOnce(rest, opts)) ?? r;
  }

  private async sayOnce(text: string | AsyncIterable<string>, opts?: SayOptions): Promise<SayResult | null> {
    const r = await Promise.race([this.transport.say(text, opts), this.stopped]);
    if (!r) return null;
    if (r.spokenText.trim()) await this.record("callback", r.spokenText.trim(), r.start_s, r.end_s);
    if (opts?.opening && !r.interrupted) this.openingEndS = r.end_s;
    return r;
  }

  /** Next utterance; null on silence or when the call ends (check `over`). */
  async hear(timeoutMs: number): Promise<Utterance | null> {
    for (;;) {
      const u = this.heardEarly.shift() ?? (await this.hearOnce(timeoutMs));
      // "Hello?" said on pickup, over the opening line, already got its answer: the opening itself.
      if (u && this.openingEndS !== null && u.start_s < this.openingEndS && classifyTurn(u.text) === "greeting") continue;
      if (u && this.ignoreBeforeS !== null && u.start_s < this.ignoreBeforeS) continue;
      return u;
    }
  }

  private async hearOnce(timeoutMs: number): Promise<Utterance | null> {
    if (this.over) return null;
    const u = await Promise.race([this.transport.listen({ timeoutMs }), this.stopped]);
    if (!u) {
      // listen() also returns null when the call ends; give transport.ended a tick to settle
      // so callers can tell silence from a dropped line.
      await Promise.race([this.stopped, new Promise((r) => setTimeout(r, 0))]);
      return null;
    }
    if (!u.text.trim()) return null;
    await this.record(this.other, u.text.trim(), u.start_s, u.end_s);
    return u;
  }

  /** Anything heard that started before `s` stays in the transcript but is never taken as a reply. */
  ignoreHeardBefore(s: number): void {
    this.ignoreBeforeS = s;
  }

  async emit(event: CallEvent): Promise<void> {
    try {
      await this.store.appendEvent(event);
    } catch (err) {
      // A missed live-screen update must never break the call itself.
      console.error(`[call ${this.call_id}] appendEvent failed:`, err);
    }
  }

  async hangup(): Promise<void> {
    try {
      await this.transport.hangup();
    } catch (err) {
      console.error(`[call ${this.call_id}] hangup failed:`, err);
    }
  }

  /** Transcript as chat messages from Callback's point of view (Callback = assistant). */
  asMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const t of this.turns) {
      const role = t.speaker === "callback" ? "assistant" : "user";
      const last = messages[messages.length - 1];
      if (last?.role === role) last.content += " " + t.text;
      else messages.push({ role, content: t.text });
    }
    // The API needs the last message to be the caller's. A fixed line we said after they spoke
    // (the disclosure repeated after an interruption) isn't something for Claude to continue.
    while (messages.at(-1)?.role === "assistant") messages.pop();
    if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(The call connects.)" });
    return messages;
  }

  /**
   * After the call: record what was heard but never taken as a reply (a "yeah" over the goodbye),
   * so the transcript has everything that was said. Reads only what the ended line already holds.
   */
  async recordUnheard(): Promise<void> {
    const ended = await Promise.race([this.transport.ended.then(() => true, () => true), new Promise<false>((r) => setTimeout(r, 0, false))]);
    if (!ended) return;
    for (let u = await this.transport.listen({ timeoutMs: 0 }); u; u = await this.transport.listen({ timeoutMs: 0 })) {
      if (u.text.trim()) await this.record(this.other, u.text.trim(), u.start_s, u.end_s);
    }
  }

  private async record(speaker: Speaker, text: string, start_s: number, end_s: number): Promise<void> {
    // In spoken order: words said over hold's line are only read after it, but happened during it.
    const at = this.turns.findIndex((t) => t.start_s > start_s);
    this.turns.splice(at === -1 ? this.turns.length : at, 0, { speaker, text, start_s, end_s });
    await this.emit({ call_id: this.call_id, type: "segment", speaker, text, ts: start_s, end_ts: end_s });
  }
}
