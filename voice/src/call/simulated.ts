// A CallTransport that never dials. For Practice runs a Claude-played supplier answers;
// for tests a script of replies does. Timings are plausible (speech-rate based) so clips work.
import type { CallRequest, SupplierRecord } from "../../../shared/contract.js";
import { MODELS, type ChatMessage, type LLM } from "./llm.js";
import type { CallTransport, EndReason, SayResult, Utterance } from "./transport.js";
import { companyFor, languageName, type Company } from "../../../lib/company.js";

export type SupplierPersona = "real" | "scammer";

export interface SimulatedTransportOptions {
  request: CallRequest;
  /** "real" knows the true history and never changed banks; "scammer" doesn't, and pushes the new account. */
  persona?: SupplierPersona;
  /** Plays the persona. Required unless `script` is given. */
  llm?: LLM;
  supplierName?: string;
  /** Who is calling. Absent = Fogline. */
  company?: Company;
  /** The payee's language: they answer in it. Absent = English. */
  language?: string;
  /** The supplier's true history, which only the "real" persona sees. */
  records?: SupplierRecord[];
  /**
   * Scripted mode (tests): one entry per listen(). Special entries:
   * "<silence>" (no reply until the timeout), "<hangup>" (they hang up), "<drop>" (line drops),
   * "<interrupt>text" (consumed by the next say(), which is cut off halfway by `text`),
   * "<over>text" (said over the next say() without cutting it, like "Hello?" on pickup).
   */
  script?: string[];
}

const SECONDS_PER_WORD = 0.38;
const REPLY_GAP_S = 0.6;
const MAX_PERSONA_TURNS = 20;

export class SimulatedTransport implements CallTransport {
  readonly ended: Promise<EndReason>;
  /** Everything said on the simulated line, for tests and Practice review. */
  readonly log: { speaker: "callback" | "supplier"; text: string }[] = [];

  private resolveEnded!: (r: EndReason) => void;
  private endReason: EndReason | null = null;
  private clock = 0;
  private readonly queue: Utterance[] = [];
  private readonly script: string[] | null;
  private personaTurns = 0;
  private hangupAfterReply = false;

  constructor(private readonly opts: SimulatedTransportOptions) {
    this.ended = new Promise((resolve) => (this.resolveEnded = resolve));
    this.script = opts.script ? [...opts.script] : null;
    if (!this.script && !opts.llm) throw new Error("SimulatedTransport needs either a script or an llm");
  }

  elapsed(): number {
    return this.clock;
  }

  async say(text: string | AsyncIterable<string>): Promise<SayResult> {
    let full = "";
    if (typeof text === "string") full = text;
    else for await (const chunk of text) full += chunk;
    full = full.trim();
    const start_s = this.clock;
    if (this.endReason) return { interrupted: true, spokenText: "", start_s, end_s: start_s };

    const next = this.script?.[0];
    if (next?.startsWith("<interrupt>")) {
      this.script!.shift();
      const words = full.split(/\s+/);
      const spokenText = words.slice(0, Math.max(1, Math.floor(words.length / 2))).join(" ");
      this.clock += duration(spokenText);
      const reply = next.slice("<interrupt>".length).trim();
      const replyStart = this.clock - 0.3;
      this.queue.push({ text: reply, start_s: replyStart, end_s: replyStart + duration(reply) });
      this.clock = replyStart + duration(reply);
      this.log.push({ speaker: "callback", text: spokenText }, { speaker: "supplier", text: reply });
      return { interrupted: true, spokenText, start_s, end_s: replyStart };
    }

    if (next?.startsWith("<over>")) {
      this.script!.shift();
      const reply = next.slice("<over>".length).trim();
      this.queue.push({ text: reply, start_s: start_s + 0.2, end_s: start_s + 0.2 + duration(reply) });
      this.log.push({ speaker: "supplier", text: reply });
    }
    this.clock += duration(full);
    this.log.push({ speaker: "callback", text: full });
    return { interrupted: false, spokenText: full, start_s, end_s: this.clock };
  }

  async listen({ timeoutMs }: { timeoutMs: number }): Promise<Utterance | null> {
    const queued = this.queue.shift();
    if (queued) return queued;
    if (this.endReason) return null;
    if (this.hangupAfterReply) return this.end("hangup");

    const reply = this.script ? this.script.shift() : await this.personaReply();
    if (reply === undefined || reply === "<hangup>") return this.end("hangup");
    if (reply === "<drop>") return this.end("dropped");
    if (reply === "<silence>" || reply.trim() === "") {
      this.clock += timeoutMs / 1000;
      return null;
    }
    const start_s = this.clock + REPLY_GAP_S;
    const end_s = start_s + duration(reply);
    this.clock = end_s;
    this.log.push({ speaker: "supplier", text: reply });
    return { text: reply, start_s, end_s };
  }

  async hangup(): Promise<void> {
    this.end("hangup");
  }

  private end(reason: EndReason): null {
    if (!this.endReason) {
      this.endReason = reason;
      this.resolveEnded(reason);
    }
    return null;
  }

  /** Next line from the Claude-played supplier; "<hangup>" when they're done, "" (silence) if Claude fails. */
  private async personaReply(): Promise<string> {
    if (++this.personaTurns > MAX_PERSONA_TURNS) return "<hangup>";
    // From the supplier's side: Callback's words are the user turns.
    const messages: ChatMessage[] = [];
    for (const entry of this.log) {
      const role = entry.speaker === "callback" ? "user" : "assistant";
      const last = messages[messages.length - 1];
      if (last?.role === role) last.content += " " + entry.text;
      else messages.push({ role, content: entry.text });
    }
    if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(Your phone rings and you answer.)" });
    let text = "";
    try {
      for await (const chunk of this.opts.llm!.streamText({ model: MODELS.fast, system: this.personaPrompt(), messages, maxTokens: 120 })) text += chunk;
    } catch (err) {
      console.error("[simulated] persona reply failed:", err);
      return "";
    }
    if (!/<hangup>/i.test(text)) return text.trim();
    // Let their goodbye be heard, then hang up on the next listen.
    const spoken = text.replace(/<hangup>/gi, "").trim();
    if (!spoken) return "<hangup>";
    this.hangupAfterReply = true;
    return spoken;
  }

  private personaPrompt(): string {
    const co = this.opts.company ?? companyFor(undefined);
    const name = this.opts.supplierName ?? `the ${co.payee.one}`;
    const who = co.payee.one === "supplier" ? `someone at ${name}, a supplier to ${co.about}` : `${name}, one of the ${co.payee.many} of ${co.about}`;
    const common = `You are on a phone call, playing ${who}. An automated assistant from ${co.owner} ${co.team} has called you. Speak like a real person on the phone, in ${languageName(this.opts.language ?? "en")}: one or two short sentences, no lists, no stage directions. When the caller says goodbye, say a brief goodbye and then write <hangup>.`;
    if ((this.opts.persona ?? "real") === "real") {
      const history = (this.opts.records ?? [])
        .map((r) => `- ${r.ref} (${r.kind}, ${r.date})${r.amount_cents === undefined ? "" : ` $${(r.amount_cents / 100).toFixed(2)}`}: ${r.text}`)
        .join("\n");
      return `${common}
You are the real supplier. You can look things up, so answer questions about your own history correctly using these records:
${history || "(no records)"}
You have NOT changed your bank account. If asked about a bank change, say clearly that you never changed your bank and that any email saying so wasn't from you.`;
    }
    return `${common}
You are a scammer pretending to be ${name}. You recently emailed ${co.name} asking them to pay a new bank account (${this.opts.request.reason.join("; ")}). You do not know the ${co.payee.one}'s real history: if asked about past invoices or calls, stall, guess vaguely, or deflect. Insist the bank change is real, say you changed banks recently, and push for the payment to go to the new account soon because it is urgent.`;
  }
}

function duration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(0.4, words * SECONDS_PER_WORD);
}
