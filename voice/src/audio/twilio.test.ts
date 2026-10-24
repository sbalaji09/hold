import twilio from "twilio";
import { describe, expect, test } from "vitest";
import {
  classifyStatus,
  dialTwiml,
  isE164,
  mediaToken,
  streamTwiml,
  staleBaseUrlHint,
  validTwilioSignature,
  verifyMediaToken,
} from "./twilio.js";

const TOKEN = "test_auth_token";
const BASE = "https://abc123.ngrok-free.app";

describe("Twilio signature", () => {
  const params = { CallSid: "CA1", CallStatus: "no-answer" };
  const path = "/twilio/status?callId=call_1";
  const sig = twilio.getExpectedTwilioSignature(TOKEN, BASE + path, params);

  test("accepts a request signed for the public URL", () => {
    expect(validTwilioSignature(TOKEN, BASE, path, params, sig)).toBe(true);
  });

  test("rejects tampered params, a different path, a missing header", () => {
    expect(validTwilioSignature(TOKEN, BASE, path, { ...params, CallStatus: "completed" }, sig)).toBe(false);
    expect(validTwilioSignature(TOKEN, BASE, "/twilio/status?callId=call_2", params, sig)).toBe(false);
    expect(validTwilioSignature(TOKEN, BASE, path, params, undefined)).toBe(false);
  });

  test("names the stale PUBLIC_BASE_URL when ngrok's URL changed under a running server", () => {
    // Real failure: ngrok restarted with a new URL, Twilio signed that one, the server still had the old one.
    const fresh = "6f72-73-93-176-12.ngrok-free.app";
    const signedForFresh = twilio.getExpectedTwilioSignature(TOKEN, `https://${fresh}${path}`, params);
    expect(validTwilioSignature(TOKEN, BASE, path, params, signedForFresh)).toBe(false);
    expect(staleBaseUrlHint(BASE, fresh)).toMatch(/https:\/\/6f72-73-93-176-12\.ngrok-free\.app.*PUBLIC_BASE_URL/);
    expect(staleBaseUrlHint(BASE, "abc123.ngrok-free.app")).toBeUndefined();
    expect(staleBaseUrlHint(BASE, undefined)).toBeUndefined();
  });
});

describe("media token", () => {
  const now = 1_700_000_000_000;
  const tok = mediaToken("secret", "call_1", "CA1", 600, now);

  test("valid for its call and sid until it expires", () => {
    expect(verifyMediaToken("secret", "call_1", "CA1", tok, now)).toBe(true);
    expect(verifyMediaToken("secret", "call_1", "CA1", tok, now + 601_000)).toBe(false);
  });

  test("bound to the call, the sid and the secret", () => {
    expect(verifyMediaToken("secret", "call_2", "CA1", tok, now)).toBe(false);
    expect(verifyMediaToken("secret", "call_1", "CA2", tok, now)).toBe(false);
    expect(verifyMediaToken("other", "call_1", "CA1", tok, now)).toBe(false);
    expect(verifyMediaToken("secret", "call_1", "CA1", undefined, now)).toBe(false);
    expect(verifyMediaToken("secret", "call_1", "CA1", "garbage", now)).toBe(false);
  });
});

describe("classifyStatus", () => {
  test.each([
    [{ CallStatus: "no-answer" }, "no_answer"],
    [{ CallStatus: "busy" }, "no_answer"],
    [{ CallStatus: "failed" }, "no_answer"],
    [{ CallStatus: "canceled" }, "no_answer"],
    [{ CallStatus: "completed" }, "completed"],
    [{ CallStatus: "ringing" }, "ignore"],
    [{ CallStatus: "in-progress" }, "ignore"],
    [{ AnsweredBy: "machine_start" }, "machine"],
    [{ AnsweredBy: "machine_end_beep" }, "machine"],
    [{ AnsweredBy: "fax" }, "machine"],
    [{ AnsweredBy: "human" }, "ignore"],
    [{ AnsweredBy: "unknown" }, "ignore"],
  ] as const)("%o -> %s", (p, want) => {
    expect(classifyStatus(p)).toBe(want);
  });
});

describe("TwiML", () => {
  test("stream TwiML escapes parameter values", () => {
    const x = streamTwiml("wss://h/media", { callId: 'a"b<c', token: "t&k" });
    expect(x).toContain('<Connect><Stream url="wss://h/media">');
    expect(x).toContain('<Parameter name="callId" value="a&quot;b&lt;c"/>');
    expect(x).toContain('value="t&amp;k"');
  });

  test("dial TwiML for takeover", () => {
    expect(dialTwiml("+14155550100", "+14155550199")).toContain('<Dial callerId="+14155550199">+14155550100</Dial>');
  });

  test("E.164", () => {
    expect(isE164("+14155550123")).toBe(true);
    expect(isE164("4155550123")).toBe(false);
    expect(isE164("+1 415 555 0123")).toBe(false);
    expect(isE164("+0123456789")).toBe(false);
  });
});
