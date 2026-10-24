// Voice server configuration, read once from the environment and validated with zod.
// Only main.ts and scripts call loadConfig(); every other module takes plain options,
// so tests run without any keys set.
import { z } from "zod";

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164, e.g. +14155550123");
const optionalE164 = z.preprocess((v) => (v === "" ? undefined : v), e164.optional());
const num = (def: number) => z.coerce.number().finite().default(def);
const bool = (def: boolean) =>
  z.preprocess((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"), z.boolean());

const schema = z.object({
  TWILIO_ACCOUNT_SID: z.string().startsWith("AC"),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_PHONE_NUMBER: e164,
  CARTESIA_API_KEY: z.string().min(1),
  CARTESIA_VOICE_ID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  MOSS_PROJECT_ID: z.string().min(1),
  MOSS_PROJECT_KEY: z.string().min(1),
  // A trailing slash makes the Convex client call "//api/query", which fails with an empty error.
  CONVEX_URL: z.string().url().transform((u) => u.replace(/\/+$/, "")),
  VOICE_SERVER_SECRET: z.string().min(16, "use at least 16 random characters"),
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "must be https (Twilio needs a public TLS URL, e.g. ngrok)")
    .transform((u) => u.replace(/\/+$/, "")),
  PORT: num(8080),
  MAYA_PHONE_NUMBER: optionalE164,

  // Cartesia
  CARTESIA_VERSION: z.string().default("2026-08-14"),
  CARTESIA_TTS_MODEL: z.string().default("sonic-3.6"),
  CARTESIA_STT_MODEL: z.string().default("ink-whisper"),
  /** How long Sonic may wait for more streamed text before it starts speaking. Lower = faster first audio. */
  CARTESIA_MAX_BUFFER_DELAY_MS: num(150),
  /** ink-whisper endpointing: silence that closes a segment server-side. */
  STT_MAX_SILENCE_S: num(0.4),
  /** ink-whisper: volume (0..1) below which audio is treated as silence. Raise in loud rooms. */
  STT_MIN_VOLUME: num(0.1),

  // Turn taking and barge-in (see voice/src/audio/vad.ts)
  /** Wait this long after a final transcript for more words before ending the turn. */
  END_OF_TURN_MS: num(250),
  /** Local silence after speech that makes us ask STT to finalize early. */
  FINALIZE_SILENCE_MS: num(300),
  /** Sustained speech needed before the energy VAD fires a barge-in. */
  VAD_MIN_SPEECH_MS: num(200),
  /** Speech must be this many dB above the adaptive noise floor. */
  VAD_MARGIN_DB: num(12),
  /** Absolute floor in dBFS; quieter frames are never speech. */
  VAD_MIN_DBFS: num(-45),
  /** Barge in on an STT partial with at least this many words, even if the VAD did not fire. */
  BARGE_IN_MIN_WORDS: num(2),
  /** During the opening line, only a transcript this long interrupts (a pickup "Hello?" must not). */
  OPENING_BARGE_IN_MIN_WORDS: num(3),

  /** Twilio async answering machine detection. Voicemail is treated as no answer. */
  TWILIO_AMD: bool(true),
  /** Seconds to ring before Twilio reports no-answer. */
  TWILIO_RING_TIMEOUT_S: num(25),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => {
    const key = i.path.join(".");
    return env[key] === undefined || env[key] === "" ? `  ${key}: missing` : `  ${key}: ${i.message}`;
  });
  throw new Error(`Invalid voice server environment (see .env.example and README.md):\n${lines.join("\n")}`);
}

/** The subset of config the audio layer needs; tests build it by hand. */
export interface AudioTuning {
  endOfTurnMs: number;
  finalizeSilenceMs: number;
  vadMinSpeechMs: number;
  vadMarginDb: number;
  vadMinDbfs: number;
  bargeInMinWords: number;
  openingBargeInMinWords: number;
}

export const DEFAULT_TUNING: AudioTuning = {
  endOfTurnMs: 250,
  finalizeSilenceMs: 300,
  vadMinSpeechMs: 200,
  vadMarginDb: 12,
  vadMinDbfs: -45,
  bargeInMinWords: 2,
  openingBargeInMinWords: 3,
};

export function tuningFrom(c: Config): AudioTuning {
  return {
    endOfTurnMs: c.END_OF_TURN_MS,
    finalizeSilenceMs: c.FINALIZE_SILENCE_MS,
    vadMinSpeechMs: c.VAD_MIN_SPEECH_MS,
    vadMarginDb: c.VAD_MARGIN_DB,
    vadMinDbfs: c.VAD_MIN_DBFS,
    bargeInMinWords: c.BARGE_IN_MIN_WORDS,
    openingBargeInMinWords: c.OPENING_BARGE_IN_MIN_WORDS,
  };
}
