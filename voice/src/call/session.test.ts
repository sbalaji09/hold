import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memoryStore.js";
import { guardStream } from "./policy.js";
import { CallSession, resumeFrom } from "./session.js";
import type { CallTransport, EndReason, SayResult, Utterance } from "./transport.js";

/**
 * A line where the first say() is cut off after `cutAfter` characters, and listen() returns
 * `heard` in order (null = silence). Records every text say() was given, in full.
 */
function line(cutAfter: number, heard: (string | null)[]) {
  const said: string[] = [];
  let cut = false;
  const transport: CallTransport = {
    ended: new Promise<EndReason>(() => undefined),
    elapsed: () => 0,
    async say(text): Promise<SayResult> {
      let full = "";
      if (typeof text === "string") full = text;
      else for await (const chunk of text) {
        full += chunk;
        if (!cut && full.length >= cutAfter) break; // the transport stops pulling once cut off
      }
      said.push(full);
      if (!cut) {
        cut = true;
        return { interrupted: true, spokenText: full.slice(0, cutAfter), start_s: 0, end_s: 1 };
      }
      return { interrupted: false, spokenText: full, start_s: 1, end_s: 2 };
    },
    async listen(): Promise<Utterance | null> {
      const text = heard.shift() ?? null;
      return text ? { text, start_s: 1, end_s: 1.5 } : null;
    },
    async hangup() {},
  };
  return { session: new CallSession(new MemoryStore(), transport, "call_1", "caller"), said };
}

const REPLY = "I can't send gift cards or anything else over the phone. If you have a question about an account or invoice, let me know who you're calling from.";
const CUT = REPLY.indexOf("about"); // "...If you have a question " was played

async function* tokens(text: string) {
  for (const t of text.match(/\S+\s*/g) ?? []) yield t;
}

describe("cut off with nothing said after it", () => {
  it("picks up a fixed line again from the start of the cut sentence", async () => {
    const { session, said } = line(CUT, [null]);
    const r = await session.say(REPLY);
    expect(said[1]).toBe("If you have a question about an account or invoice, let me know who you're calling from.");
    expect(r?.interrupted).toBe(false);
  });

  it("picks up a streamed Claude reply too, including the part the transport never read", async () => {
    const { session, said } = line(CUT, [null]);
    await session.say(guardStream(tokens(REPLY), () => false, "Sorry."));
    expect(said[1]).toBe("If you have a question about an account or invoice, let me know who you're calling from.");
  });

  it("the transcript has what was actually played, then the rest", async () => {
    const { session } = line(CUT, [null]);
    await session.say(REPLY);
    expect(session.turns.map((t) => t.text)).toEqual([
      "I can't send gift cards or anything else over the phone. If you have a question",
      "If you have a question about an account or invoice, let me know who you're calling from.",
    ]);
  });
});

describe("cut off by real words", () => {
  it("doesn't carry on, and the words are the next thing heard", async () => {
    const { session, said } = line(CUT, ["Wait, who am I speaking to?"]);
    const r = await session.say(REPLY);
    expect(r?.interrupted).toBe(true);
    expect(said).toHaveLength(1);
    expect((await session.hear(1000))?.text).toBe("Wait, who am I speaking to?");
  });
});

describe("resumeFrom", () => {
  it.each([
    ["Hello there. How are", "Hello there. How are you today?", "How are you today?"],
    ["Hel", "Hello there. How are you today?", "Hello there. How are you today?"],
    ["Hello there. ", "Hello there. How are you today?", "How are you today?"],
    ["Hello there. How are you today?", "Hello there. How are you today?", null],
    ["Something else", "Hello there.", null],
  ])("%j of %j -> %j", (spoken, full, rest) => {
    expect(resumeFrom(full, spoken)).toBe(rest);
  });
});
