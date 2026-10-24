// The seam between "what to say" (call/ sessions) and "how it reaches a person"
// (audio/ phone transport over Twilio + Cartesia, or the simulated supplier for Practice).

export interface Utterance {
  text: string; // final transcript of one turn
  start_s: number; // seconds since the call was answered (aligned with the recording)
  end_s: number;
}

export interface SayResult {
  /** True if the other person started talking and playback was cut (barge-in). */
  interrupted: boolean;
  /** Best estimate of the text actually played before the cut (all of it if not interrupted). */
  spokenText: string;
  start_s: number;
  end_s: number;
}

export type EndReason = "hangup" | "dropped" | "takeover";

export interface CallTransport {
  /**
   * Speak text. Accepts a stream of text chunks (e.g. Claude tokens) for low first-audio latency.
   * Always interruptible: if the person starts talking, audio stops at once and this resolves
   * with interrupted=true; their words arrive through listen().
   */
  say(text: string | AsyncIterable<string>): Promise<SayResult>;
  /**
   * Next final utterance from the other person. Utterances heard while not listening
   * (including the one that interrupted say()) are queued and returned first.
   * Resolves null on timeoutMs of silence or when the call has ended.
   */
  listen(opts: { timeoutMs: number }): Promise<Utterance | null>;
  /** Hang up from our side. Idempotent. */
  hangup(): Promise<void>;
  /** Resolves once when the call is over, with why. */
  readonly ended: Promise<EndReason>;
  /** Seconds since the call was answered. */
  elapsed(): number;
}
