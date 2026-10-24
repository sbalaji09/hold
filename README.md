# hold

## Setup

```sh
pnpm install
cp .env.example .env   # then fill in; .env is git-ignored, never commit keys
npx convex dev          # terminal 1: Convex functions, codegen, and `npx convex env set` target
pnpm dev                 # terminal 2: the Next.js app
```

Env vars: see `.env.example` for the full list and which ones are Convex-side (`npx convex env set NAME value`) vs local (`.env`).

Run tests with `pnpm vitest run`.

Before pushing anything under `convex/`, it must pass the stricter check used at deploy time:

```sh
npx tsc -p convex/tsconfig.json --noEmit
```


<!-- BEGIN voice section: owned by the voice half (voice/, Twilio, Cartesia). Edit inside with care. -->
## Voice (Cartesia)

The voice server (`voice/src/main.ts`) places hold's outgoing check calls and answers Fogline's phone line.
See `plan-voice.md` for what the calls must do and `docs/voice-architecture.md` for the build map.
It talks to Twilio (telephony), Cartesia (speech in and out), Claude (what to say), Moss (supplier history) and Convex (everything else).

### Setup

#### 1. Install

```sh
pnpm install
cp .env.example .env   # then fill it in; .env is git-ignored, never commit keys
```

#### 2. Environment variables

The server validates these at startup and lists anything missing or malformed.

| Variable | What it is |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID (`AC...`). The account must be upgraded: trial accounts play a notice and can only call verified numbers. |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. Used for REST calls, webhook signature checks and recording downloads. |
| `TWILIO_PHONE_NUMBER` | Fogline's Twilio number in E.164 (`+14155550123`). Outgoing check calls come from it and incoming calls arrive on it. |
| `CARTESIA_API_KEY` | Cartesia API key (speech-to-text and text-to-speech). |
| `CARTESIA_VOICE_ID` | The Sonic voice hold speaks with. Pick one in the Cartesia playground and copy its id. |
| `ANTHROPIC_API_KEY` | Claude, which builds questions, speaks live turns and judges answers. |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | Moss project for the per-supplier history indexes. |
| `CONVEX_URL` | Your Convex deployment URL (`npx convex dev` prints it). |
| `VOICE_SERVER_SECRET` | A long random string shared with Convex. Also run `npx convex env set VOICE_SERVER_SECRET <same value>`. It also signs the per-call media tokens. |
| `NGROK_DOMAIN`, `NGROK_AUTHTOKEN` | Local dev. Your free permanent ngrok domain (ngrok dashboard, Domains) and authtoken. The voice server opens the tunnel itself, so you never run `ngrok`. |
| `TWILIO_POINT_WEBHOOK` | `true` to point Fogline's number at this server on startup. Whichever server starts last owns the number. |
| `PUBLIC_BASE_URL` | The public `https://` URL Twilio uses to reach this server. Leave it unset in dev: it comes from `NGROK_DOMAIN`. On Fly.io the deploy script sets it. |
| `PORT` | Local port, default `8080`. |
| `MAYA_PHONE_NUMBER` | Optional. "End call and take over" transfers the live call to this number. Without it, takeover just ends the AI call. |

Optional tuning knobs, all with defaults that suit a phone on speaker in a loud room:

| Variable | Default | Effect |
|---|---|---|
| `CARTESIA_TTS_MODEL` | `sonic-3.6` | Sonic model id. |
| `CARTESIA_STT_MODEL` | `ink-whisper` | Speech-to-text model. |
| `CARTESIA_VERSION` | `2026-08-14` | Cartesia API version. |
| `CARTESIA_MAX_BUFFER_DELAY_MS` | `150` | How long Sonic waits for more streamed text before speaking. Lower is faster, higher is smoother. |
| `STT_MAX_SILENCE_S` | `0.4` | Silence that makes ink-whisper close a segment. |
| `STT_MIN_VOLUME` | `0.1` | ink-whisper treats quieter audio as silence. Raise it if venue noise turns into words. |
| `END_OF_TURN_MS` | `250` | Wait after a final transcript for more words before replying. |
| `FINALIZE_SILENCE_MS` | `300` | Local silence after speech that makes us ask STT to finalize early. |
| `VAD_MIN_SPEECH_MS` | `200` | Sustained speech needed to barge in. 150 to 250 works on speakerphones. |
| `VAD_MARGIN_DB` | `12` | How far above the background noise counts as speech. Raise it if noise cuts hold off. |
| `VAD_MIN_DBFS` | `-45` | Absolute floor; quieter audio is never speech. |
| `BARGE_IN_MIN_WORDS` | `2` | An STT partial with this many words also barges in. |
| `OPENING_BARGE_IN_MIN_WORDS` | `3` | During the opening greeting or disclosure, voice alone never barges in; only a transcript this long does, so a pickup "Hello?" doesn't cut it. |
| `TWILIO_AMD` | `true` | Answering machine detection. Voicemail counts as no answer. Set `false` if a real person on a noisy speakerphone gets taken for a machine. |
| `TWILIO_RING_TIMEOUT_S` | `25` | Ring time before Twilio reports no answer. |

#### 3. Run everything

```sh
pnpm dev:all
```

This starts Convex, the app and the voice server together, with labelled output.
The voice server opens its ngrok tunnel on `NGROK_DOMAIN` and, with `TWILIO_POINT_WEBHOOK=true`, points Fogline's number at itself.
Check `https://<NGROK_DOMAIN>/healthz` returns `{"ok":true,...}`.
Saving voice code or `.env` restarts the voice server, so don't edit them during a call.

To point the number by hand instead, run `npx tsx --env-file=.env scripts/twilioWebhook.ts`.
In the Twilio Console the same setting is Phone Numbers, Active numbers, Fogline's number, Voice Configuration: "A call comes in", Webhook, `https://<server>/twilio/inbound`, HTTP POST.
Outgoing calls need no console setup: the server passes its own TwiML URL, status callback and recording callback on every call.
Make sure the account is upgraded and that Voice Geographic Permissions allow the countries you will call.

#### 4. Hosting the voice server (demo day)

For rehearsals and the demo, run the voice server on Fly.io so the phone line doesn't depend on a laptop, its Wi-Fi or a stray save.
One-time setup:

```sh
brew install flyctl
fly auth login
fly apps create <name>   # then set app = "<name>" in fly.toml
```

Deploy (and redeploy after voice changes):

```sh
scripts/deployVoice.sh
```

It sends `.env` to Fly as secrets (without the local-only ngrok settings), bakes in Moss's model and deploys one machine at `https://<name>.fly.dev`.
On boot that machine points Fogline's number at itself.
Keep exactly one voice server answering the number: when the Fly machine is live, run the app with `pnpm dev` and `pnpm convex:dev`, not `pnpm dev:all`.
To hand the number back to Fly after local work, run `fly machine restart -a <name>`.
Watch it with `fly logs -a <name>`.

**Hello world call.**
Before wiring the whole loop, prove the phone and Cartesia work:

```sh
npx tsx --env-file=.env scripts/helloCall.ts +1YOURCELL
```

It dials your phone, speaks the disclosure with Sonic, listens with ink-whisper and repeats back what you said.
Talk over it to try barge-in.
It needs only the Twilio and Cartesia variables plus `PUBLIC_BASE_URL` (or `NGROK_DOMAIN`), and the dev voice server must not be running.

**Tests** run without any keys or network:

```sh
npx vitest run voice/src/audio voice/src/server voice/src/dialer
```

#### Server routes

| Route | Called by | Does |
|---|---|---|
| `POST /twilio/inbound` | Twilio, Fogline's number | Returns `<Connect><Stream>` to `/media` for the incoming line. |
| `POST /twilio/outbound/:callId` | Twilio, answered outgoing call | Returns `<Connect><Stream>` for that check call. |
| `POST /twilio/status?callId=` | Twilio status and async AMD callbacks | No answer, busy, failed, canceled or voicemail: report no answer (Convex schedules the one retry or hands off). |
| `POST /twilio/recording?callId=` | Twilio recording callback | Downloads the mp3 with auth and attaches it to the call. |
| `WS /media` | Twilio Media Streams | Checks the per-call token, then runs the conversation over Cartesia. |
| `GET /healthz` | You | Liveness. |

Every `/twilio/*` request must carry a valid `X-Twilio-Signature`.
The media websocket only accepts a stream whose `token` parameter is an HMAC (bound to call id, Twilio call SID and a 10 minute expiry) from TwiML we served.

### Cartesia

Cartesia is the voice on every call, outgoing and incoming.
Phone audio goes Twilio, then Cartesia speech-to-text, then Claude, then Cartesia Sonic, then back to the phone, in real time.

#### Features used

- **Sonic text-to-speech over the websocket API** (`wss://api.cartesia.ai/tts/websocket`), one socket per call, opened when the call connects so the first sentence has no handshake delay.
- **Raw `pcm_mulaw` at 8000 Hz output**, which is exactly what Twilio plays, so there is no resampling or transcoding.
- **Contexts with streamed input** (`context_id` plus `continue: true`): Claude's tokens are forwarded as they arrive, cut on word boundaries, so hold starts speaking before Claude has finished the sentence. `max_buffer_delay_ms` keeps prosody natural while text trickles in.
- **Context cancel** for barge-in, plus dropping any audio for a cancelled context that was already in flight.
- **Word timestamps** (`add_timestamps`), combined with Twilio playback marks, to work out what the caller actually heard before they interrupted. That text is what goes in the transcript, not the full sentence we meant to say.
- **ink-whisper streaming speech-to-text** (`wss://api.cartesia.ai/stt/websocket`) with `pcm_mulaw` 8000 Hz input, so Twilio's frames go straight in.
- **Endpointing controls**: `min_volume` and `max_silence_duration_secs`, plus the `finalize` command, which we send as soon as our own voice detector hears the caller stop, instead of waiting for server-side silence.
- **Partial transcripts** as a second barge-in trigger alongside the energy detector.
- A configured voice (`CARTESIA_VOICE_ID`) used for every call.

Raw websockets (the `ws` package) were chosen over the SDK because barge-in needs exact control: cancel a context, ignore its late chunks, and recover a dropped socket mid-sentence without losing the rest of the reply.

#### How it stays conversational

- **Short turn gaps.** The end of a turn is detected locally: an energy detector on the mu-law frames hears the caller stop, we send `finalize`, and the turn closes 250 ms after the final transcript. Claude's reply is streamed into Sonic as it is generated. Each turn logs `turnGapMs` (end of caller speech to hold's first audio), `thinkMs` (Claude) and `ttsFirstAudioMs` (Sonic) as JSON lines, so a rehearsal can be measured. The target is under 800 ms.
- **Barge-in.** If the caller talks over hold, sustained speech (about 200 ms, so a cough or clap does not count) or a two-word partial transcript stops playback at once: Twilio `clear` empties the phone's audio buffer and the Cartesia context is cancelled. hold then listens, and their words are the next thing it answers.
- **Loud rooms.** The demo phone is on speaker at a busy table. The detector compares each frame with the quietest audio of the last 1.5 s, so steady crowd noise becomes the baseline instead of a trigger. All thresholds are environment knobs (above).
- **Recovery.** If either Cartesia socket drops mid-call it reconnects. Speech-to-text replays up to 2 s of buffered audio; text-to-speech re-sends only the part of the sentence that had not been generated yet, on a fresh context.

#### Known limitations

- Echo: barge-in relies on the caller's phone cancelling hold's own voice. A cheap speakerphone at full volume can leak hold's audio back into its mic and cut it off. Lower the phone volume, or raise `VAD_MARGIN_DB` and `BARGE_IN_MIN_WORDS`.
- A sudden jump in background noise (music starting) can read as speech for up to 1.5 s, until it becomes the new baseline. That can cause one false barge-in.
- If Claude pauses for more than about a second mid-reply, Sonic's context expires; we continue on a new context, which can make a small prosody seam.
- What-was-heard on barge-in is an estimate from playback marks and word timestamps, accurate to roughly a word.
- Transcript times are measured from the start of the media stream; the REST recording starts a few hundred milliseconds later at most, so clips can be off by that much.
- Phone audio is 8 kHz, so names and invoice numbers are sometimes misheard. Questions are written to be answered with amounts and plain words.
- Answering machine detection can misjudge a person on a noisy speakerphone as a machine; set `TWILIO_AMD=false` for the stage demo if that happens.
- Recordings of incoming calls stay in Twilio; only outgoing check calls get a recording attached in the app.
- If the voice server restarts during a live call, that call is cut and its request stays in "dialing" with no result; it needs a manual follow-up. Avoid editing voice code during a demo (`tsx watch` restarts on save).
- Moss loads its embedding model through onnxruntime, which can crash while Node exits. A clean Ctrl-C can therefore end with exit code 134 after shutdown has finished; calls and data are unaffected.
- The first Moss warm on a new machine downloads a 46 MB embedding model (about 3 minutes). Start the voice server once before the demo so it is cached.
<!-- END voice section -->
