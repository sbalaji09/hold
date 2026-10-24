// One live conversation over a CallTransport: speaks and listens, keeps the transcript, writes
// segment events as each turn happens, and notices the end of the call (hangup, drop, takeover).
import type { CallEvent, Speaker } from "../../../shared/contract.js";
import type { VoiceStore } from "../store/types.js";
import type { ChatMessage } from "./llm.js";
import { classifyTurn } from "./policy.js";
import type { CallTransport, EndReason, SayOptions, SayResult, Utterance } from "./transport.js";

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

  /** Mark the call over. The first reason wins (a drop stays a drop if Maya presses takeover later). */
  end(reason: EndReason): void {
    this.reason ??= reason;
    this.stop();
  }

  /** Speak; resolves null if the call ends first. Writes a segment with what was actually played. */
  async say(text: string | AsyncIterable<string>, opts?: SayOptions): Promise<SayResult | null> {
    if (this.over) return null;
    const r = await Promise.race([this.transport.say(text, opts), this.stopped]);
    if (!r) return null;
    if (r.spokenText.trim()) await this.record("callback", r.spokenText.trim(), r.start_s, r.end_s);
    if (opts?.opening && !r.interrupted) this.openingEndS = r.end_s;
    return r;
  }

  /** Next utterance; null on silence or when the call ends (check `over`). */
  async hear(timeoutMs: number): Promise<Utterance | null> {
    for (;;) {
      const u = await this.hearOnce(timeoutMs);
      // "Hello?" said on pickup, over the opening line, already got its answer: the opening itself.
      if (u && this.openingEndS !== null && u.start_s < this.openingEndS && classifyTurn(u.text) === "greeting") continue;
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

  private async record(speaker: Speaker, text: string, start_s: number, end_s: number): Promise<void> {
    this.turns.push({ speaker, text, start_s, end_s });
    await this.emit({ call_id: this.call_id, type: "segment", speaker, text, ts: start_s, end_ts: end_s });
  }
}
