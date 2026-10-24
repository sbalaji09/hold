// The handful of Twilio REST calls the voice server makes, behind a small interface so the
// dialer and server can be tested with a fake. Plus TwiML builders and webhook helpers.
import { createHmac, timingSafeEqual } from "node:crypto";
import twilio from "twilio";

export interface DialParams {
  to: string;
  from: string;
  /** TwiML webhook for the answered call. */
  url: string;
  statusCallback: string;
  ringTimeoutS: number;
  amd: boolean;
}

export interface TwilioApi {
  dial(p: DialParams): Promise<{ sid: string }>;
  /** End the call whatever its state (ringing calls are canceled, live ones completed). */
  hangup(callSid: string): Promise<void>;
  /** Replace the live call's TwiML (takeover: <Dial> Maya). */
  redirect(callSid: string, twiml: string): Promise<void>;
  /** Start recording both sides now; Twilio posts recordingStatusCallback when done. */
  startRecording(callSid: string, statusCallback: string): Promise<void>;
  /** Download a finished recording as mp3. */
  downloadRecording(recordingUrl: string): Promise<Uint8Array>;
}

export function twilioApi(accountSid: string, authToken: string): TwilioApi {
  const client = twilio(accountSid, authToken);
  return {
    async dial(p) {
      const call = await client.calls.create({
        to: p.to,
        from: p.from,
        url: p.url,
        method: "POST",
        statusCallback: p.statusCallback,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        timeout: p.ringTimeoutS,
        ...(p.amd
          ? {
              machineDetection: "Enable",
              asyncAmd: "true",
              asyncAmdStatusCallback: p.statusCallback,
              asyncAmdStatusCallbackMethod: "POST",
            }
          : {}),
      });
      return { sid: call.sid };
    },
    async hangup(callSid) {
      const call = await client.calls(callSid).fetch();
      if (call.status === "in-progress") await client.calls(callSid).update({ status: "completed" });
      else if (["queued", "initiated", "ringing"].includes(call.status)) await client.calls(callSid).update({ status: "canceled" });
    },
    async redirect(callSid, twiml) {
      await client.calls(callSid).update({ twiml });
    },
    async startRecording(callSid, statusCallback) {
      await client.calls(callSid).recordings.create({
        recordingStatusCallback: statusCallback,
        recordingStatusCallbackMethod: "POST",
        recordingStatusCallbackEvent: ["completed"],
        recordingChannels: "mono",
      });
    },
    async downloadRecording(recordingUrl) {
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      // Media can 404 for a moment after the "completed" callback; retry briefly.
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(`${recordingUrl}.mp3`, { headers: { Authorization: `Basic ${auth}` } });
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        if (res.status !== 404 || attempt >= 4) throw new Error(`recording download failed: ${res.status}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    },
  };
}

/**
 * Sends Fogline's number's incoming calls to this voice server. Clearing voiceApplicationSid
 * matters: an attached TwiML app would silently override voiceUrl. Returns the previous URL.
 */
export async function pointNumberAt(
  accountSid: string,
  authToken: string,
  phoneNumber: string,
  publicBaseUrl: string,
): Promise<{ voiceUrl: string; previous: string | null }> {
  const client = twilio(accountSid, authToken);
  const [number] = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  if (!number) throw new Error(`${phoneNumber} is not a number on this Twilio account`);
  const voiceUrl = `${publicBaseUrl.replace(/\/+$/, "")}/twilio/inbound`;
  if (number.voiceUrl !== voiceUrl || number.voiceMethod !== "POST" || number.voiceApplicationSid) {
    await client.incomingPhoneNumbers(number.sid).update({ voiceUrl, voiceMethod: "POST", voiceApplicationSid: "" });
  }
  return { voiceUrl, previous: number.voiceUrl || null };
}

// ---------------------------------------------------------------- TwiML

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** <Connect><Stream>: bidirectional media to our websocket, with custom parameters. */
export function streamTwiml(wsUrl: string, params: Record<string, string>): string {
  const ps = Object.entries(params)
    .map(([k, v]) => `<Parameter name="${xml(k)}" value="${xml(v)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(wsUrl)}">${ps}</Stream></Connect></Response>`;
}

export function dialTwiml(number: string, callerId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${xml(callerId)}">${xml(number)}</Dial></Response>`;
}

export const hangupTwiml = () => `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

// ---------------------------------------------------------------- webhook security

/**
 * Checks X-Twilio-Signature. Behind ngrok the request reaches us as http://localhost, but Twilio
 * signed the public URL, so we rebuild it from PUBLIC_BASE_URL plus the path and query.
 */
export function validTwilioSignature(
  authToken: string,
  publicBaseUrl: string,
  pathAndQuery: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  return twilio.validateRequest(authToken, signature, publicBaseUrl + pathAndQuery, params);
}

/**
 * The usual cause of bad signatures in development: ngrok restarted with a new URL while the
 * server kept the old PUBLIC_BASE_URL. Twilio signs the URL it called, so every webhook fails.
 */
export function staleBaseUrlHint(publicBaseUrl: string, host: string | undefined): string | undefined {
  if (!host) return undefined;
  const called = `https://${host}`;
  if (called === publicBaseUrl) return undefined;
  return `Twilio called ${called} but PUBLIC_BASE_URL is ${publicBaseUrl}. Set PUBLIC_BASE_URL to the current ngrok URL, restart the voice server, then run scripts/twilioWebhook.ts.`;
}

/**
 * Per-call media token: the TwiML we return (to a signature-checked webhook) carries it as a
 * <Parameter>, and the media websocket refuses any stream without a valid one.
 */
export function mediaToken(secret: string, callId: string, callSid: string, ttlS = 600, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + ttlS;
  return `${exp}.${sign(secret, callId, callSid, exp)}`;
}

export function verifyMediaToken(
  secret: string,
  callId: string,
  callSid: string,
  token: string | undefined,
  nowMs = Date.now(),
): boolean {
  const [expStr, mac] = (token ?? "").split(".");
  const exp = Number(expStr);
  if (!mac || !Number.isInteger(exp) || exp * 1000 < nowMs) return false;
  const want = Buffer.from(sign(secret, callId, callSid, exp));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

const sign = (secret: string, callId: string, callSid: string, exp: number) =>
  createHmac("sha256", secret).update(`${callId}\n${callSid}\n${exp}`).digest("base64url");

// ---------------------------------------------------------------- status mapping

export type StatusKind = "no_answer" | "machine" | "completed" | "ignore";

/** Maps a status or async-AMD callback to what the dialer does about it. */
export function classifyStatus(p: { CallStatus?: string; AnsweredBy?: string }): StatusKind {
  const by = p.AnsweredBy;
  if (by && (by.startsWith("machine") || by === "fax")) return "machine";
  if (by) return "ignore"; // human or unknown: carry on (unknown is common on a noisy speakerphone)
  switch (p.CallStatus) {
    case "no-answer":
    case "busy":
    case "failed":
    case "canceled":
      return "no_answer";
    case "completed":
      return "completed";
    default:
      return "ignore";
  }
}

export const isE164 = (n: string) => /^\+[1-9]\d{6,14}$/.test(n);
