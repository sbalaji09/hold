import { describe, expect, it } from "vitest";
import type { CallEventDoc, CallRequestDoc, CallResultDoc, LiveCall } from "./api";
import {
  buildTranscript,
  callTimes,
  callView,
  citeLabel,
  formatElapsed,
  formatPhone,
  formatTime,
  formatWhen,
  numberSourceLabel,
  parseTime,
} from "./format";

// 2026-10-23 2:15 PM in San Francisco (PDT, UTC-7).
const T = Date.UTC(2026, 9, 23, 21, 15);

type Fields<E> = E extends CallEventDoc ? Omit<E, "_id" | "_creationTime" | "call_id"> : never;
let n = 0;
function ev(fields: Fields<CallEventDoc>, at = T): CallEventDoc {
  return { _id: `e${n++}`, _creationTime: at, call_id: "c1", ...fields } as unknown as CallEventDoc;
}
const status = (value: Extract<CallEventDoc, { type: "status" }>["value"], at = T, extra: { retry_at?: string } = {}) =>
  ev({ type: "status", value, ...extra }, at);

function req(fields: Partial<CallRequestDoc> = {}): CallRequestDoc {
  return {
    _id: "r1",
    _creationTime: T,
    call_id: "c1",
    bill_id: "b1",
    supplier_id: "sup_stage",
    to_number: "+14155550142",
    number_source: "on_file",
    reason: [],
    status: "dialing",
    attempt: 1,
    ...fields,
  } as unknown as CallRequestDoc;
}

function res(outcome: CallResultDoc["outcome"], at = T): CallResultDoc {
  return { _id: "x1", _creationTime: at, call_id: "c1", outcome, evidence: [], summary: "", recording_url: "" } as unknown as CallResultDoc;
}

function call(request: CallRequestDoc | null, events: CallEventDoc[] = [], result: CallResultDoc | null = null): LiveCall {
  return { request, events, result };
}

describe("formatting", () => {
  it("formats times in Fogline's time zone", () => {
    expect(formatTime(T)).toBe("2:15 PM");
    expect(formatWhen(T, T + 60_000)).toBe("Today 2:15 PM");
    expect(formatWhen(T, T + 86_400_000)).toBe("Yesterday 2:15 PM");
    expect(formatWhen(T, T + 3 * 86_400_000)).toBe("Oct 23, 2:15 PM");
  });

  it("formats timecodes", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(-5000)).toBe("00:00");
    expect(formatElapsed(7_999)).toBe("00:07");
    expect(formatElapsed(750_000)).toBe("12:30");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  it("formats US numbers and leaves others alone", () => {
    expect(formatPhone("+14155550142")).toBe("(415) 555-0142");
    expect(formatPhone("+442071234567")).toBe("+442071234567");
    expect(formatPhone("anonymous")).toBe("anonymous");
  });

  it("labels cites and number sources", () => {
    expect(citeLabel({ kind: "invoice", ref: "#4471" })).toBe("Invoice #4471");
    expect(citeLabel({ kind: "email", ref: "Email 12 Sep" })).toBe("Email 12 Sep");
    expect(citeLabel({ kind: "invoice", ref: "INV-4471 · Sep 12" })).toBe("INV-4471 · Sep 12");
    expect(numberSourceLabel("on_file")).toBe("on file");
    expect(numberSourceLabel("background_check")).toBe("from background check");
  });

  it("parses ISO times", () => {
    expect(parseTime("2026-10-23T21:15:00.000Z")).toBe(T);
    expect(parseTime("")).toBeNull();
    expect(parseTime("not a date")).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});

describe("callView", () => {
  it("covers the normal path", () => {
    expect(callView(call(req({ status: "queued", attempt: 0 })))).toMatchObject({ line: "ringing", label: "Dialing", active: true });
    expect(callView(call(req({ status: "queued", attempt: undefined })))).toMatchObject({ label: "Dialing" });
    expect(callView(call(req({ status: "dialing" })))).toMatchObject({ line: "ringing", label: "Dialing", active: true });
    expect(callView(call(req({ status: "dialing" }), [status("ringing")]))).toEqual({ line: "ringing", active: true });
    expect(callView(call(req({ status: "in_progress" }), [status("in_progress")]))).toEqual({ line: "connected", active: true });
    expect(callView(call(req({ status: "done" })))).toMatchObject({ label: "Call ended", active: false });
  });

  it("reports outcomes", () => {
    expect(callView(call(req({ status: "done" }), [], res("confirmed")))).toEqual({ line: "confirmed", active: false });
    expect(callView(call(req({ status: "done" }), [], res("not_confirmed")))).toEqual({ line: "not-confirmed", active: false });
    expect(callView(call(req({ status: "handed_off" }), [], res("handed_off")))).toMatchObject({
      label: "Handed off",
      note: "Handed off to you.",
      active: false,
    });
  });

  it("says no answer, with the retry time", () => {
    const noAnswer = [status("ringing"), status("no_answer")];
    const fromString = call(req({ status: "retry_scheduled" }), [...noAnswer, status("retry_scheduled", T, { retry_at: "2:15 PM" })]);
    expect(callView(fromString)).toEqual({ line: "no-answer", note: "No answer. Trying again at 2:15 PM.", active: true });
    expect(callView(call(req({ status: "retry_scheduled", retry_at_ms: T }), noAnswer)).note).toBe("No answer. Trying again at 2:15 PM.");
    expect(callView(call(req({ status: "retry_scheduled" }))).note).toBe("No answer. Trying again shortly.");
    expect(callView(call(req({ status: "queued", attempt: 1 }), noAnswer)).label).toBe("Calling again");
    expect(callView(call(req({ status: "handed_off" }), [...noAnswer, ...noAnswer], res("handed_off")))).toMatchObject({
      line: "no-answer",
      note: "No answer after the retry. Handed off to you.",
    });
  });

  it("says when and where the line dropped", () => {
    const events = [status("in_progress", T), status("dropped", T + 48_000)];
    expect(callView(call(req({ status: "in_progress" }), events))).toEqual({ line: "dropped", note: "Line dropped at 00:48.", active: false });
    expect(callView(call(req({ status: "handed_off" }), events, res("handed_off"))).note).toBe("Line dropped at 00:48. Handed off to you.");
  });

  it("shows a takeover", () => {
    expect(callView(call(req({ status: "in_progress", takeover_requested: true })))).toMatchObject({ label: "Ending call", active: false });
    expect(callView(call(req({ status: "handed_off", takeover_requested: true }), [], res("handed_off")))).toMatchObject({
      label: "Taken over",
      note: "You took over the call.",
    });
  });

  it("handles a missing request", () => {
    expect(callView(call(null))).toMatchObject({ active: false });
  });
});

describe("callTimes", () => {
  it("starts when answered and stops when it ends", () => {
    const events = [status("ringing", T), status("in_progress", T + 4000)];
    expect(callTimes(call(req(), events))).toEqual({ startMs: T + 4000, endMs: null });
    const ended = [...events, status("ended", T + 30_000)];
    expect(callTimes(call(req(), ended))).toEqual({ startMs: T + 4000, endMs: T + 30_000 });
    expect(callTimes(call(req({ startedAt: new Date(T + 1000).toISOString() }), ended)).startMs).toBe(T + 1000);
    expect(callTimes(call(req(), [], res("handed_off", T + 9000)))).toEqual({ startMs: null, endMs: T + 9000 });
  });
});

describe("buildTranscript", () => {
  const source = { kind: "invoice", ref: "INV-4471" };

  it("puts a question's source on the agent line that asks it", () => {
    const rows = buildTranscript([
      status("in_progress"),
      ev({ type: "segment", speaker: "callback", text: "Hi", ts: 0 }),
      ev({ type: "question", ask: "Invoice number?", source }),
      ev({ type: "segment", speaker: "callback", text: "What was the invoice number?", ts: 3 }),
      ev({ type: "segment", speaker: "supplier", text: "4471", ts: 6 }),
    ]);
    expect(rows.map((r) => [r.speaker, r.text, r.ts, r.source?.ref])).toEqual([
      ["callback", "Hi", 0, undefined],
      ["callback", "What was the invoice number?", 3, "INV-4471"],
      ["supplier", "4471", 6, undefined],
    ]);
  });

  it("shows lines in the order they were said, not the order hold read them", () => {
    // Rosa's call: her pickup "Hi." was only read after hold's first question.
    const rows = buildTranscript([
      ev({ type: "segment", speaker: "callback", text: "Hi, this is an automated assistant.", ts: 0 }),
      ev({ type: "question", ask: "Can you tell me what invoice 4139 was for?", source }),
      ev({ type: "segment", speaker: "callback", text: "Can you tell", ts: 12.2 }),
      ev({ type: "segment", speaker: "supplier", text: "Hi.", ts: 0.4 }),
      ev({ type: "segment", speaker: "supplier", text: "Yeah.", ts: 12 }),
    ]);
    expect(rows.map((r) => [r.text, r.source?.ref])).toEqual([
      ["Hi, this is an automated assistant.", undefined],
      ["Hi.", undefined],
      ["Yeah.", undefined],
      ["Can you tell", "INV-4471"],
    ]);
  });

  it("keeps a question with no matching line as its own row", () => {
    const rows = buildTranscript([
      ev({ type: "question", ask: "Q1", source }),
      ev({ type: "segment", speaker: "supplier", text: "Hello?", ts: 1 }),
      ev({ type: "question", ask: "Q2", source }),
      ev({ type: "question", ask: "Q3", source }),
    ]);
    expect(rows.map((r) => [r.speaker, r.text, r.ts, r.source?.ref])).toEqual([
      ["callback", "Q1", 0, "INV-4471"],
      ["supplier", "Hello?", 1, undefined],
      ["callback", "Q2", 1, "INV-4471"],
      ["callback", "Q3", 1, "INV-4471"],
    ]);
  });
});
