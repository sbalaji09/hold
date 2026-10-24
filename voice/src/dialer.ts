// Dialing loop: turns queued call_requests into phone calls (or simulated Practice calls).
//
// For each newly queued request: start building questions (Moss pre-warm + Claude) right away,
// claim the row, emit "ringing", then dial request.to_number and nothing else. While it rings the
// questions finish, so the first question adds no dead air. Every Twilio status / AMD callback,
// media stream and takeover for the call is routed here, keyed by call_id.
import type { CallRequest, CallResult, NumberSource, SupplierProfile } from "../../shared/contract.js";
import type { SupplierSearch } from "../../shared/search.js";
import { log } from "./audio/log.js";
import type { PhoneTransport } from "./audio/phoneTransport.js";
import { dialTwiml, isE164, type StatusKind, type TwilioApi } from "./audio/twilio.js";
import type { OutboundCallDeps, PrepareOutboundDeps, PreparedCall } from "./call/index.js";
import type { LLM } from "./call/llm.js";
import type { CallTransport } from "./call/transport.js";
import type { VoiceStore } from "./store/types.js";

const DIALABLE_SOURCES: ReadonlySet<NumberSource> = new Set(["on_file", "background_check"]);

export interface DialerDeps {
  store: VoiceStore;
  search: SupplierSearch;
  llm: LLM;
  twilio: TwilioApi;
  publicBaseUrl: string;
  fromNumber: string;
  mayaNumber?: string;
  amd: boolean;
  ringTimeoutS: number;
  prepare: (deps: PrepareOutboundDeps) => Promise<PreparedCall>;
  run: (deps: OutboundCallDeps) => Promise<CallResult>;
  /** Practice: a transport with a simulated supplier instead of a phone. */
  simulated: (request: CallRequest, prepared: PreparedCall) => Promise<CallTransport>;
  /** If no media stream starts this long after dialing, give up on the attempt. */
  watchdogMs?: number;
}

interface LiveCall {
  request: CallRequest;
  prepared: Promise<PreparedCall>;
  /** The payee's profile: their language and phone menu. Null if it couldn't be read. */
  profile: Promise<SupplierProfile | null>;
  language?: string;
  callSid: string | null;
  transport: PhoneTransport | null;
  /** The outcome of this attempt is decided (no answer, voicemail, takeover before answer). */
  settled: boolean;
  /** Voicemail detected mid-call: drop whatever the conversation layer writes from now on. */
  aborted: boolean;
  takeover: boolean;
  takeoverCbs: Set<() => void>;
  unwatchTakeover: () => void;
  watchdog: NodeJS.Timeout | null;
  /** Store handed to the conversation layer for this call (see scopedStore). */
  store: VoiceStore;
}

export class Dialer {
  private readonly calls = new Map<string, LiveCall>();
  private unsubscribe: (() => void) | null = null;
  private stopping = false;

  constructor(private readonly d: DialerDeps) {}

  start() {
    this.unsubscribe = this.d.store.watchQueuedRequests((requests) => {
      for (const r of requests) this.consider(r);
    });
  }

  get activeCalls() {
    return this.calls.size;
  }

  /** The language to speak on a live call, for its speech-to-text and voice. Absent = English. */
  languageFor(callId: string): string | undefined {
    return this.calls.get(callId)?.language;
  }

  /** Stop taking new requests, let live calls finish (up to graceMs), then hang up the rest. */
  async stop(graceMs = 20_000): Promise<void> {
    this.stopping = true;
    this.unsubscribe?.();
    const deadline = Date.now() + graceMs;
    while (this.calls.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    await Promise.all(
      [...this.calls.values()].map(async (c) => {
        if (c.transport) await c.transport.hangup();
        else if (c.callSid) await this.d.twilio.hangup(c.callSid).catch(() => undefined);
      }),
    );
  }

  // ---------------------------------------------------------------- queue -> dial

  private consider(r: CallRequest) {
    if (this.stopping || r.status !== "queued" || this.calls.has(r.call_id)) return;
    const c: LiveCall = {
      request: r,
      prepared: this.d.prepare({ request: r, store: this.d.store, search: this.d.search, llm: this.d.llm }),
      profile: this.d.store.getSupplierProfile(r.supplier_id).catch(() => null),
      callSid: null,
      transport: null,
      settled: false,
      aborted: false,
      takeover: false,
      takeoverCbs: new Set(),
      unwatchTakeover: () => undefined,
      watchdog: null,
      store: this.d.store,
    };
    c.prepared.catch(() => undefined); // awaited later; avoid an unhandled rejection meanwhile
    void c.profile.then((p) => (c.language = p?.language));
    c.store = scopedStore(this.d.store, c);
    this.calls.set(r.call_id, c);
    this.begin(c).catch((err) => {
      log.error("dialer: request failed", { callId: r.call_id, err: String(err) });
      this.cleanup(c);
    });
  }

  private async begin(c: LiveCall) {
    const id = c.request.call_id;
    const claimed = await this.d.store.claimRequest(id);
    if (!claimed) {
      this.cleanup(c); // someone else has it
      return;
    }
    c.request = claimed;
    c.unwatchTakeover = this.d.store.watchTakeover(id, () => void this.onTakeover(c));
    if (claimed.mode === "simulated") {
      await this.emitStatus(id, "ringing");
      return this.runSimulated(c);
    }

    // Only ever dial the number we were given, and only if it came from a trusted source.
    if (!DIALABLE_SOURCES.has(claimed.number_source) || !isE164(claimed.to_number)) {
      log.error("dialer: refusing to dial", { callId: id, source: claimed.number_source, to: claimed.to_number });
      c.settled = true;
      await this.d.store.finishCall({
        call_id: id,
        outcome: "handed_off",
        evidence: [],
        summary: "Callback did not place the call because the number on the request was not a trusted, valid number.",
      });
      return this.cleanup(c);
    }

    await this.emitStatus(id, "ringing");
    const base = this.d.publicBaseUrl;
    const q = `callId=${encodeURIComponent(id)}`;
    // A phone menu ("press 2 for payoffs") is answered with keys from the profile, never from the call.
    const menu = (await c.profile)?.phone_menu;
    try {
      const { sid } = await this.d.twilio.dial({
        to: claimed.to_number,
        from: this.d.fromNumber,
        url: `${base}/twilio/outbound/${encodeURIComponent(id)}`,
        statusCallback: `${base}/twilio/status?${q}`,
        ringTimeoutS: this.d.ringTimeoutS,
        // Machine detection would hang up on the menu's recorded greeting.
        amd: this.d.amd && !menu,
        ...(menu ? { sendDigits: menu } : {}),
      });
      c.callSid = sid;
    } catch (err) {
      log.error("dialer: Twilio dial failed", { callId: id, err: String(err) });
      return this.noAnswer(c);
    }
    log.info("dialing", { callId: id, callSid: c.callSid, attempt: claimed.attempt });
    await this.d.store.setTwilioCallSid(id, c.callSid).catch((err) => log.warn("setTwilioCallSid failed", { err: String(err) }));

    if (c.takeover) return this.onTakeover(c, true); // pressed while we were dialing
    c.watchdog = setTimeout(
      () => {
        if (c.transport || c.settled) return;
        log.warn("dialer: no media stream; treating as no answer", { callId: id });
        if (c.callSid) void this.d.twilio.hangup(c.callSid).catch(() => undefined);
        void this.noAnswer(c);
      },
      this.d.watchdogMs ?? (this.d.ringTimeoutS + 60) * 1000,
    );
    c.watchdog.unref?.();
  }

  private async runSimulated(c: LiveCall) {
    try {
      const prepared = await c.prepared;
      const transport = await this.d.simulated(c.request, prepared);
      await this.d.run({ store: c.store, transport, request: c.request, prepared, llm: this.d.llm });
    } catch (err) {
      log.error("dialer: simulated call failed", { callId: c.request.call_id, err: String(err) });
      await this.handOff(c, "Callback could not run the practice call.");
    } finally {
      this.cleanup(c);
    }
  }

  // ---------------------------------------------------------------- events from the server

  /** The answered call's media stream started (server verified its token). Runs the conversation. */
  async attachStream(callId: string, callSid: string, transport: PhoneTransport): Promise<void> {
    const c = this.calls.get(callId);
    if (!c || c.callSid !== callSid || c.settled || c.transport) {
      log.warn("dialer: unexpected media stream; hanging up", { callId, callSid });
      await transport.hangup();
      return;
    }
    c.transport = transport;
    if (c.watchdog) clearTimeout(c.watchdog);
    try {
      let prepared: PreparedCall;
      try {
        prepared = await c.prepared;
      } catch (err) {
        log.error("dialer: question building failed", { callId, err: String(err) });
        await transport.hangup();
        await this.handOff(c, "Callback could not prepare questions for this supplier, so the call was ended.");
        return;
      }
      if (c.takeover) {
        // Pressed after answer but before the conversation started: onTakeover already moved the call.
        await this.handOff(c, "Maya took over as the call connected.");
        return;
      }
      await this.d.run({ store: c.store, transport, request: c.request, prepared, llm: this.d.llm });
    } catch (err) {
      log.error("dialer: call failed", { callId, err: String(err) });
    } finally {
      this.cleanup(c);
    }
  }

  /** Twilio status or async-AMD callback (already classified, signature already checked). */
  async onStatus(callId: string, callSid: string, kind: StatusKind): Promise<void> {
    const c = this.calls.get(callId);
    if (!c || c.callSid !== callSid || kind === "ignore") return;
    if (kind === "machine") {
      if (c.settled) return;
      log.info("voicemail detected; treating as no answer", { callId });
      c.aborted = true;
      await this.d.twilio.hangup(callSid).catch((err) => log.warn("hangup failed", { err: String(err) }));
      await this.noAnswer(c, Boolean(c.transport)); // a running conversation cleans up when it ends
      return;
    }
    if (c.transport) {
      // The call ended while streaming; normally the stream's own stop got there first.
      if (kind === "completed") c.transport.onStreamEnd();
      return;
    }
    // Ended without ever reaching a conversation: no answer, busy, failed, or hung up at once.
    await this.noAnswer(c);
  }

  // ---------------------------------------------------------------- takeover / endings

  private async onTakeover(c: LiveCall, again = false) {
    if (c.takeover && !again) return;
    c.takeover = true;
    const id = c.request.call_id;
    const fireCallLayer = () => {
      for (const cb of c.takeoverCbs) cb();
    };
    if (c.request.mode === "simulated" || c.settled) return fireCallLayer();
    if (c.transport) {
      // Mark first so the stream stop caused by the redirect reads as a takeover, not a drop.
      c.transport.markTakeover();
      const sid = c.callSid!;
      try {
        if (this.d.mayaNumber) await this.d.twilio.redirect(sid, dialTwiml(this.d.mayaNumber, this.d.fromNumber));
        else await this.d.twilio.hangup(sid);
      } catch (err) {
        log.error("takeover: Twilio update failed", { callId: id, err: String(err) });
      }
      log.info("takeover", { callId: id, transferredTo: this.d.mayaNumber ? "maya" : null });
      return fireCallLayer(); // the conversation layer writes handed_off with what it heard
    }
    if (c.callSid) {
      // Still ringing: cancel the call; nobody else will write the result.
      c.settled = true;
      await this.d.twilio.hangup(c.callSid).catch(() => undefined);
      await this.handOff(c, "Maya took over before the call was answered.");
      this.cleanup(c);
    }
    // Otherwise we are mid-dial; begin() re-checks c.takeover once Twilio returns the sid.
  }

  private async noAnswer(c: LiveCall, keepEntry = false) {
    if (c.settled) return;
    c.settled = true;
    try {
      const { retry_at_ms } = await this.d.store.reportNoAnswer(c.request.call_id);
      log.info("no answer", { callId: c.request.call_id, retryAt: retry_at_ms });
    } catch (err) {
      log.error("reportNoAnswer failed", { callId: c.request.call_id, err: String(err) });
    }
    if (!keepEntry) this.cleanup(c);
  }

  private async handOff(c: LiveCall, summary: string) {
    try {
      await this.d.store.finishCall({ call_id: c.request.call_id, outcome: "handed_off", evidence: [], summary });
    } catch (err) {
      log.error("finishCall failed", { callId: c.request.call_id, err: String(err) });
    }
  }

  private async emitStatus(call_id: string, value: "ringing") {
    await this.d.store
      .appendEvent({ call_id, type: "status", value })
      .catch((err) => log.warn("appendEvent failed", { err: String(err) }));
  }

  private cleanup(c: LiveCall) {
    if (this.calls.get(c.request.call_id) !== c) return;
    if (c.watchdog) clearTimeout(c.watchdog);
    c.unwatchTakeover();
    this.calls.delete(c.request.call_id);
  }
}

/**
 * The store the conversation layer sees for one call:
 *   - takeover callbacks fire only after the dialer has redirected the call to Maya, so the
 *     conversation layer's own hangup can never race the transfer;
 *   - after voicemail is detected (async AMD, mid-conversation), its writes are dropped, because
 *     the attempt has already been reported as no answer.
 */
function scopedStore(store: VoiceStore, c: LiveCall): VoiceStore {
  const overrides: Partial<VoiceStore> = {
    watchTakeover: (_id, cb) => {
      c.takeoverCbs.add(cb);
      if (c.takeover) queueMicrotask(cb);
      return () => c.takeoverCbs.delete(cb);
    },
    appendEvent: (e) => (c.aborted ? Promise.resolve() : store.appendEvent(e)),
    markInProgress: (id) => (c.aborted ? Promise.resolve() : store.markInProgress(id)),
    finishCall: (r) => (c.aborted ? Promise.resolve() : store.finishCall(r)),
  };
  return new Proxy(store, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop as keyof VoiceStore];
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
