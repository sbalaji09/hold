// Voice server entry point: config -> Convex store, Moss, Claude, Twilio, Cartesia -> server + dialer.
import { ConvexClient } from "convex/browser";
import { MossSearch } from "../../shared/mossSearch.js";
import { cartesiaSttFactory } from "./audio/cartesiaStt.js";
import { cartesiaTtsFactory } from "./audio/cartesiaTts.js";
import { log } from "./audio/log.js";
import ngrok from "@ngrok/ngrok";
import { pointNumberAt, twilioApi } from "./audio/twilio.js";
import { AnthropicLLM, prepareOutboundCall, runInboundCall, runOutboundCall, SimulatedTransport } from "./call/index.js";
import { loadConfig, tuningFrom } from "./config.js";
import { Dialer } from "./dialer.js";
import { createVoiceServer } from "./server.js";
import { ConvexStore } from "./store/convexStore.js";

const config = loadConfig();
const store = new ConvexStore(new ConvexClient(config.CONVEX_URL), config.VOICE_SERVER_SECRET);
const search = new MossSearch(config.MOSS_PROJECT_ID, config.MOSS_PROJECT_KEY);
const llm = new AnthropicLLM();

// Load the shared Moss index now, so the first call's question lookup adds no dead air.
// Not awaited: the server starts regardless, and each call's warm() reuses or retries this load.
const warmStarted = Date.now();
search
  .warm()
  .then(() => log.info("moss index ready", { ms: Date.now() - warmStarted }))
  .catch((err) => log.warn("moss warm failed; calls will retry it", { error: String(err) }));
const twilio = twilioApi(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

const dialer = new Dialer({
  store,
  search,
  llm,
  twilio,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  fromNumber: config.TWILIO_PHONE_NUMBER,
  takeoverPhoneNumber: config.TAKEOVER_PHONE_NUMBER,
  amd: config.TWILIO_AMD,
  ringTimeoutS: config.TWILIO_RING_TIMEOUT_S,
  prepare: prepareOutboundCall,
  run: runOutboundCall,
  simulated: async (request, prepared) =>
    new SimulatedTransport({
      request,
      llm,
      supplierName: prepared.supplierName,
      company: prepared.company,
      language: prepared.language,
      records: await store.getSupplierRecords(request.supplier_id),
    }),
});

const cartesia = { apiKey: config.CARTESIA_API_KEY, version: config.CARTESIA_VERSION };
const server = createVoiceServer({
  publicBaseUrl: config.PUBLIC_BASE_URL,
  authToken: config.TWILIO_AUTH_TOKEN,
  secret: config.VOICE_SERVER_SECRET,
  store,
  llm,
  twilio,
  dialer,
  runInbound: runInboundCall,
  stt: cartesiaSttFactory({
    ...cartesia,
    model: config.CARTESIA_STT_MODEL,
    minVolume: config.STT_MIN_VOLUME,
    maxSilenceS: config.STT_MAX_SILENCE_S,
  }),
  tts: cartesiaTtsFactory({
    ...cartesia,
    model: config.CARTESIA_TTS_MODEL,
    voiceId: config.CARTESIA_VOICE_ID,
    ...(config.CARTESIA_VOICE_ID_ES ? { voiceIdByLanguage: { es: config.CARTESIA_VOICE_ID_ES } } : {}),
    maxBufferDelayMs: config.CARTESIA_MAX_BUFFER_DELAY_MS,
  }),
  tuning: tuningFrom(config),
});

let tunnel: ngrok.Listener | null = null;

/** Listen, open the tunnel (local dev), point Twilio at us, and only then start dialing. */
async function start() {
  await new Promise<void>((resolve) => server.listen(config.PORT, resolve));
  log.info("voice server listening", { port: config.PORT, publicBaseUrl: config.PUBLIC_BASE_URL });
  if (config.NGROK_DOMAIN) {
    tunnel = await ngrok.forward({ addr: config.PORT, domain: config.NGROK_DOMAIN, authtoken: config.NGROK_AUTHTOKEN });
    log.info("ngrok tunnel open", { url: tunnel.url() });
  }
  if (config.TWILIO_POINT_WEBHOOK) {
    const { voiceUrl, previous } = await pointNumberAt(
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_AUTH_TOKEN,
      config.TWILIO_PHONE_NUMBER,
      config.PUBLIC_BASE_URL,
    );
    log.info("twilio number points here", { number: config.TWILIO_PHONE_NUMBER, voiceUrl, previous });
  }
  dialer.start();
}

start().catch((err) => {
  // Without the tunnel or the webhook, every call would fail; say so and stop.
  log.error("voice server failed to start", { error: String(err) });
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) process.exit(1); // second Ctrl-C: leave now
  shuttingDown = true;
  log.info("shutting down; letting live calls finish", { signal, calls: dialer.activeCalls });
  await dialer.stop();
  server.close(); // stop accepting; open media sockets die with the process
  await tunnel?.close();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
