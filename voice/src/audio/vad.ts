// Tiny energy VAD on mu-law frames: the fast barge-in trigger, and our local end-of-speech signal.
//
// Tuned for a phone on speaker in a loud venue: venue noise reaches us through the phone's mic,
// so a fixed threshold would fire constantly. Instead the noise floor is the quietest frame of the
// last floorWindowMs (minimum statistics: speech has gaps between words, crowd noise does not),
// and a frame is "speech" only when it is marginDb above that floor and above an absolute minimum.
// A barge-in needs minSpeechMs of sustained speech (short gaps allowed), so claps, coughs and
// door slams do not cut Callback off.
import { bytesToMs, frameDbfs } from "./mulaw.js";

export interface VadOptions {
  /** Sustained speech needed before onset fires. 150-250 ms works for speakerphones. */
  minSpeechMs: number;
  /** dB above the noise floor that counts as speech. */
  marginDb: number;
  /** Frames quieter than this (dBFS) are never speech. */
  minDbfs: number;
  /** Silence after speech before "offset" fires (we then ask STT to finalize early). */
  hangoverMs: number;
  /** Gap inside a speech run that does not reset it. */
  maxGapMs?: number;
  /** Window for the noise floor (minimum frame level over this long). */
  floorWindowMs?: number;
}

export type VadEvent = "onset" | "offset" | null;

export class EnergyVad {
  /** Adaptive noise floor in dBFS (quietest recent frame). */
  noiseFloor = -96;
  /** True between onset and offset. */
  speaking = false;
  /** ms of speech in the current run (before onset) or ms of silence (while speaking). */
  private runMs = 0;
  private gapMs = 0;
  private readonly maxGapMs: number;
  private readonly recent: number[] = [];
  private readonly floorWindowMs: number;

  constructor(private readonly opts: VadOptions) {
    this.maxGapMs = opts.maxGapMs ?? 60;
    this.floorWindowMs = opts.floorWindowMs ?? 1500;
  }

  /** Feed one frame. Returns "onset" once per speech run, "offset" after hangoverMs of silence. */
  push(frame: Uint8Array): VadEvent {
    const ms = bytesToMs(frame.length);
    const db = frameDbfs(frame);
    this.trackFloor(db, ms);
    const loud = db > Math.max(this.opts.minDbfs, this.noiseFloor + this.opts.marginDb);

    if (!this.speaking) {
      if (loud) {
        this.runMs += ms + (this.runMs > 0 ? this.gapMs : 0); // a dip inside speech counts as speech
        this.gapMs = 0;
        if (this.runMs >= this.opts.minSpeechMs) {
          this.speaking = true;
          this.runMs = 0;
          return "onset";
        }
      } else {
        this.gapMs += ms;
        if (this.gapMs > this.maxGapMs) {
          this.runMs = 0;
          this.gapMs = 0;
        }
      }
      return null;
    }

    if (loud) {
      this.runMs = 0;
      return null;
    }
    this.runMs += ms;
    if (this.runMs >= this.opts.hangoverMs) {
      this.speaking = false;
      this.runMs = 0;
      this.gapMs = 0;
      return "offset";
    }
    return null;
  }

  private trackFloor(db: number, ms: number) {
    // A sudden jump in venue noise reads as speech for at most one window, then becomes the floor.
    this.recent.push(db);
    if (this.recent.length > Math.max(1, Math.round(this.floorWindowMs / ms))) this.recent.shift();
    this.noiseFloor = Math.min(...this.recent);
  }
}
