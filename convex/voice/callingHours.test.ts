// Calling hours: with CALLING_HOURS set, a live check call waits for the payee's weekday business
// hours instead of ringing at night, and the wait doesn't use up an attempt.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";
import { formatCallingTime, nextCallingTime, parseCallingHours } from "./rules.js";

const LA = "America/Los_Angeles";
const at = (local: string) => new Date(`${local}-07:00`).getTime(); // October, so PDT

describe("calling hours rules", () => {
  const hours = parseCallingHours("8-18");

  test("parses a range and ignores nonsense", () => {
    expect(hours).toEqual({ start: 8, end: 18 });
    expect(parseCallingHours(undefined)).toBeNull();
    expect(parseCallingHours("18-8")).toBeNull();
    expect(parseCallingHours("always")).toBeNull();
  });

  test("a weekday afternoon is open; a night waits for the morning; a weekend waits for Monday", () => {
    expect(nextCallingTime(at("2026-10-23T14:30:00"), LA, hours)).toBeNull();
    expect(nextCallingTime(at("2026-10-22T23:10:00"), LA, hours)).toBe(at("2026-10-23T08:00:00"));
    const saturday = nextCallingTime(at("2026-10-24T11:00:00"), LA, hours)!;
    expect(saturday).toBe(at("2026-10-26T08:00:00"));
    expect(formatCallingTime(saturday, LA)).toBe("Mon 8:00 AM");
  });

  test("no hours configured means any time", () => {
    expect(nextCallingTime(at("2026-10-24T03:00:00"), LA, null)).toBeNull();
  });
});

describe("claimRequest outside calling hours", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-10-24T11:00:00")); // a Saturday
    vi.stubEnv("VOICE_SERVER_SECRET", "s3cret");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function queued() {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("callRequests", {
        call_id: "call_1",
        bill_id: "bill_1",
        supplier_id: "emp_gutierrez",
        to_number: "+16195550200",
        number_source: "on_file",
        reason: ["new bank account"],
        status: "queued",
        attempt: 0,
        mode: "live",
      }),
    );
    return t;
  }

  test("waits for Monday morning without using an attempt", async () => {
    vi.stubEnv("CALLING_HOURS", "8-18");
    const t = await queued();
    expect(await t.mutation(api.voice.server.claimRequest, { secret: "s3cret", call_id: "call_1" })).toBeNull();
    const row = await t.run((ctx) => ctx.db.query("callRequests").first());
    expect(row).toMatchObject({ status: "retry_scheduled", attempt: 0, retry_at_ms: at("2026-10-26T08:00:00") });
    const events = await t.run((ctx) => ctx.db.query("callEvents").collect());
    expect(events).toEqual([expect.objectContaining({ type: "status", value: "outside_hours", retry_at: "Mon 8:00 AM" })]);
  });

  test("dials at once when no calling hours are set", async () => {
    const t = await queued();
    expect(await t.mutation(api.voice.server.claimRequest, { secret: "s3cret", call_id: "call_1" })).toMatchObject({ status: "dialing", attempt: 1 });
  });
});
