// voiceOnline reports whether the voice server's heartbeat is recent enough to trust it is running.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

describe("voiceOnline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    vi.stubEnv("VOICE_SERVER_SECRET", "s3cret");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("no heartbeat yet reports offline", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.voice.ui.voiceOnline, {})).toEqual({ online: false, lastSeenAt: null });
  });

  test("a heartbeat within 45s reports online; one older than 45s reports offline", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.voice.server.heartbeat, { secret: "s3cret" });
    expect(await t.query(api.voice.ui.voiceOnline, {})).toMatchObject({ online: true });

    vi.advanceTimersByTime(46_000);
    expect(await t.query(api.voice.ui.voiceOnline, {})).toMatchObject({ online: false });
  });
});
