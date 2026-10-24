import { describe, expect, test } from "vitest";
import { decodeMulaw, encodeMulaw, frameDbfs } from "./mulaw.js";
import { EnergyVad } from "./vad.js";

/** 20 ms (160-sample) mu-law frame of a 300 Hz tone at the given amplitude. */
export function tone(amplitude: number, ms = 20): Uint8Array {
  const n = (ms * 8000) / 1000;
  return encodeMulaw(Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * 300 * i) / 8000)));
}

describe("mu-law", () => {
  test("round-trips within G.711 quantisation error", () => {
    for (const v of [0, 1, -1, 100, -100, 1000, -5000, 12345, -32000, 32767]) {
      const back = decodeMulaw(encodeMulaw([v]))[0]!;
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(8, Math.abs(v) * 0.07));
    }
  });

  test("known code points", () => {
    expect(decodeMulaw(Uint8Array.of(0xff))[0]).toBe(0);
    expect(decodeMulaw(Uint8Array.of(0x7f))[0]).toBe(0);
    expect(decodeMulaw(Uint8Array.of(0x00))[0]).toBe(-32124);
    expect(decodeMulaw(Uint8Array.of(0x80))[0]).toBe(32124);
  });

  test("frame level in dBFS", () => {
    expect(frameDbfs(tone(0))).toBe(-96);
    // RMS of a sine is amplitude / sqrt(2): 16384 -> about -9 dBFS
    expect(frameDbfs(tone(16384))).toBeCloseTo(-9, 0);
    expect(frameDbfs(tone(328))).toBeCloseTo(-43, 0);
  });
});

describe("EnergyVad", () => {
  const vad = () => new EnergyVad({ minSpeechMs: 200, marginDb: 12, minDbfs: -45, hangoverMs: 300 });
  const feed = (v: EnergyVad, frame: Uint8Array, count: number) => {
    const events: string[] = [];
    for (let i = 0; i < count; i++) {
      const e = v.push(frame);
      if (e) events.push(e);
    }
    return events;
  };

  test("needs sustained speech before onset, then offset after the hangover", () => {
    const v = vad();
    feed(v, tone(30), 50); // a second of quiet line noise
    expect(feed(v, tone(8000), 9)).toEqual([]); // 180 ms: not yet
    expect(feed(v, tone(8000), 1)).toEqual(["onset"]); // 200 ms
    expect(feed(v, tone(8000), 20)).toEqual([]); // one onset per run
    expect(feed(v, tone(30), 14)).toEqual([]); // 280 ms of silence
    expect(feed(v, tone(30), 1)).toEqual(["offset"]); // 300 ms
  });

  test("ignores short bursts (a clap or cough)", () => {
    const v = vad();
    feed(v, tone(30), 50);
    for (let i = 0; i < 10; i++) {
      expect(feed(v, tone(12000), 4)).toEqual([]); // 80 ms burst
      feed(v, tone(30), 10); // 200 ms gap resets the run
    }
  });

  test("tolerates short dips inside speech", () => {
    const v = vad();
    feed(v, tone(30), 50);
    const events = [...feed(v, tone(8000), 5), ...feed(v, tone(30), 2), ...feed(v, tone(8000), 5)];
    expect(events).toEqual(["onset"]);
  });

  test("learns loud venue noise so it does not count as speech", () => {
    const v = vad();
    const crowd = tone(2500); // about -22 dBFS of steady noise
    feed(v, tone(30), 50); // quiet line before the crowd starts
    // The crowd starting up reads as one speech run, until it becomes the floor (one window).
    expect(feed(v, crowd, 150)).toEqual(["onset", "offset"]);
    expect(v.noiseFloor).toBeGreaterThan(-26);
    expect(feed(v, crowd, 500)).toEqual([]);
    // A talker close to the phone is still well above the floor.
    expect(feed(v, tone(26000), 12)).toEqual(["onset"]);
  });
});
