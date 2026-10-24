// Manual smoke test: "your code dials a phone and Cartesia speaks".
// Dials one number, speaks the disclosure with Sonic, listens with ink-whisper, repeats back what
// it heard (talk over it to try barge-in), then hangs up. Uses the real server, transport and TwiML.
//
//   ngrok http 8080            # PUBLIC_BASE_URL in .env = the https forwarding URL
//   npx tsx --env-file=.env scripts/helloCall.ts +14155550123
//
// Needs TWILIO_*, CARTESIA_API_KEY, CARTESIA_VOICE_ID, PUBLIC_BASE_URL. Nothing touches Convex.
import { randomBytes } from "node:crypto";
import { DISCLOSURE } from "../shared/contract.js";
import { cartesiaSttFactory } from "../voice/src/audio/cartesiaStt.js";
import { cartesiaTtsFactory } from "../voice/src/audio/cartesiaTts.js";
import type { PhoneTransport } from "../voice/src/audio/phoneTransport.js";
import { isE164, twilioApi } from "../voice/src/audio/twilio.js";
import type { LLM } from "../voice/src/call/llm.js";
import { loadConfig, tuningFrom } from "../voice/src/config.js";
import { createVoiceServer } from "../voice/src/server.js";
import type { VoiceStore } from "../voice/src/store/types.js";

const to = process.argv[2] ?? "";
if (!isE164(to)) {
  console.error("usage: npx tsx --env-file=.env scripts/helloCall.ts +14155550123");
  process.exit(1);
}

// Only Twilio and Cartesia matter here; fill the rest so validation passes.
const config = loadConfig({
  ANTHROPIC_API_KEY: "unused",
  MOSS_PROJECT_ID: "unused",
  MOSS_PROJECT_KEY: "unused",
  CONVEX_URL: "https://unused.convex.cloud",
  ...process.env,
  VOICE_SERVER_SECRET: process.env.VOICE_SERVER_SECRET || randomBytes(24).toString("hex"),
});
const twilio = twilioApi(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
const CALL_ID = "hello";
let callSid = "";

async function converse(t: PhoneTransport) {
  const t0 = Date.now();
  const first = await t.say(DISCLOSURE);
  console.log(`disclosure: interrupted=${first.interrupted} heard="${first.spokenText}"`);
  await t.say("This is a test call. Say something, and I'll repeat it back.");
  const u = await t.listen({ timeoutMs: 8000 });
  console.log(u ? `heard: "${u.text}" (${u.start_s.toFixed(2)}-${u.end_s.toFixed(2)} s)` : "heard nothing");
  const reply = await t.say(
    (async function* () {
      // Streamed like Claude tokens, to exercise continuations.
      for (const w of `You said: ${u?.text ?? "nothing"}. Thanks, goodbye.`.split(" ")) yield w + " ";
    })(),
  );
  console.log(`reply: interrupted=${reply.interrupted} heard="${reply.spokenText}"`);
  await t.hangup();
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const server = createVoiceServer({
  publicBaseUrl: config.PUBLIC_BASE_URL,
  authToken: config.TWILIO_AUTH_TOKEN,
  secret: config.VOICE_SERVER_SECRET,
  store: {
    attachRecording: async (_id: string, audio: Uint8Array) => console.log(`recording ready: ${audio.length} bytes`),
  } as unknown as VoiceStore,
  llm: null as unknown as LLM,
  twilio,
  dialer: {
    activeCalls: 1,
    async attachStream(callId, sid, transport) {
      if (callId !== CALL_ID || sid !== callSid) return transport.hangup();
      await converse(transport);
      setTimeout(() => process.exit(0), 3000); // let the recording callback land
    },
    async onStatus(_callId, _sid, kind) {
      console.log(`status: ${kind}`);
      if (kind === "no_answer" || kind === "machine") process.exit(2);
    },
  },
  runInbound: async () => undefined,
  stt: cartesiaSttFactory({
    apiKey: config.CARTESIA_API_KEY,
    version: config.CARTESIA_VERSION,
    model: config.CARTESIA_STT_MODEL,
    minVolume: config.STT_MIN_VOLUME,
    maxSilenceS: config.STT_MAX_SILENCE_S,
  }),
  tts: cartesiaTtsFactory({
    apiKey: config.CARTESIA_API_KEY,
    version: config.CARTESIA_VERSION,
    model: config.CARTESIA_TTS_MODEL,
    voiceId: config.CARTESIA_VOICE_ID,
    maxBufferDelayMs: config.CARTESIA_MAX_BUFFER_DELAY_MS,
  }),
  tuning: tuningFrom(config),
});

server.listen(config.PORT, async () => {
  const base = config.PUBLIC_BASE_URL;
  const { sid } = await twilio.dial({
    to,
    from: config.TWILIO_PHONE_NUMBER,
    url: `${base}/twilio/outbound/${CALL_ID}`,
    statusCallback: `${base}/twilio/status?callId=${CALL_ID}`,
    ringTimeoutS: config.TWILIO_RING_TIMEOUT_S,
    amd: false,
  });
  callSid = sid;
  console.log(`dialing ${to} (${sid}) via ${base}`);
});
