// G.711 mu-law helpers for Twilio's 8 kHz mono phone audio.
// Cartesia accepts and produces pcm_mulaw directly, so we only decode for the energy VAD.

export const SAMPLE_RATE = 8000;
/** mu-law is one byte per sample. */
export const bytesToMs = (bytes: number) => (bytes * 1000) / SAMPLE_RATE;

const BIAS = 0x84;
const CLIP = 32635;

const DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  DECODE[i] = u & 0x80 ? -magnitude : magnitude;
}

export function decodeMulaw(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE[bytes[i]!]!;
  return out;
}

export function encodeMulawSample(sample: number): number {
  let s = Math.max(-CLIP, Math.min(CLIP, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function encodeMulaw(samples: Int16Array | number[]): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = encodeMulawSample(samples[i]!);
  return out;
}

/** RMS level of a mu-law frame in dBFS (0 = full scale, about -96 for digital silence). */
export function frameDbfs(bytes: Uint8Array): number {
  if (bytes.length === 0) return -96;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = DECODE[bytes[i]!]!;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / bytes.length);
  return rms < 1 ? -96 : 20 * Math.log10(rms / 32768);
}
