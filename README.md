# hold

## Setup

```sh
pnpm install
cp .env.example .env   # then fill in; .env is git-ignored, never commit keys
npx convex dev          # terminal 1: Convex functions, codegen, and `npx convex env set` target
pnpm dev                 # terminal 2: the Next.js app
```

Env vars: see `.env.example` for the full list and which ones are Convex-side (`npx convex env set NAME value`) vs local (`.env`) — that now includes `APIFY_ACTOR_ID` (Convex-side) and `NEXT_PUBLIC_CONVEX_URL` (local, same value as `CONVEX_URL`).

Run tests with `pnpm vitest run`.

### Apify

hold's own actor, [`celebratory_trefoil/hold-supplier-verifier`](https://console.apify.com/actors/ghhS5OMt08eiVJkXb) (source in `actor/`, deploy with `cd actor && apify push -b latest`), does three jobs:

- **Copycat check** on every bill from a domain that isn't the supplier's, or from a look-alike sender (`convex/app/background.ts`, scheduled by intake). It lands on the bill as one more check.
- **Background check** on a new supplier (site, contact phone, domain age, SPF/DMARC, Maps listing).
- **Look-alike watch**, nightly at 10:00 UTC and from **Scan now** on a supplier page (`convex/app/watch.ts`). It finds registered look-alikes of every supplier domain; an email from one is flagged on arrival.

Set `APIFY_TOKEN` and `APIFY_ACTOR_ID=celebratory_trefoil~hold-supplier-verifier` on the Convex deployment. Without the token, the copycat and background checks fall back to local heuristics and the watch doesn't run. To run the watch by hand: `npx convex run app/watch:startWatch`.

### Company templates

hold runs for one company per deployment (`lib/company.ts`). `pnpm seed` loads Fogline (festival bills), `pnpm seed:bayline` loads Bayline Title & Escrow (closing wires) and `pnpm seed:harbor` loads Harbor Health (clinic payroll). With `ALLOW_TEMPLATE_SWITCH=true` set in the Convex env, the Workspace screen (click the company name in the sidebar) switches between them in the app. Regenerate the two newer datasets with `npx tsx data/generateWorkspaces.ts`.

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
| `PUBLIC_BASE_URL` | The public `https://` URL Twilio uses to reach this server. Leave it unset: it comes from `NGROK_DOMAIN`. |
| `PORT` | Local port, default `8080`. |
| `TAKEOVER_PHONE_NUMBER` | Optional. "End call and take over" transfers the live call to this number. Without it, takeover just ends the AI call. |
| `CARTESIA_VOICE_ID_ES` | Optional. A native Spanish Sonic voice for calls to Spanish-speaking payees. Without it, `CARTESIA_VOICE_ID` speaks Spanish. |

Convex-side settings for the company templates and calls (`npx convex env set NAME value`):

| Variable | What it is |
|---|---|
| `ALLOW_TEMPLATE_SWITCH` | `true` lets the Workspace screen load another company template (Fogline, Bayline Title, Harbor Health). It replaces every payee, bill and call; learned playbooks are kept. |
| `DEMO_PAYEE_PHONE` | A real phone a teammate holds. Loading a template makes it the number on file for that template's demo payee (Stagecraft, Marcia Delgado, María Gutiérrez). |
| `CALLING_HOURS` | e.g. `8-18`. Live check calls wait for the payee's weekday business hours in their time zone and show "Calling Mon 8:00 AM". Unset = call any time (keep it unset for a weekend demo). |

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
For the demo, run `pnpm demo:all` instead: the same three, but the app is a production build, so every tab opens instantly (the dev server renders each page the first time you open it, about half a second).
The voice server opens its ngrok tunnel on `NGROK_DOMAIN` and, with `TWILIO_POINT_WEBHOOK=true`, points Fogline's number at itself.
Check `https://<NGROK_DOMAIN>/healthz` returns `{"ok":true,...}`.
Saving voice code or `.env` restarts the voice server, so don't edit them during a call.

To point the number by hand instead, run `npx tsx --env-file=.env scripts/twilioWebhook.ts`.
In the Twilio Console the same setting is Phone Numbers, Active numbers, Fogline's number, Voice Configuration: "A call comes in", Webhook, `https://<server>/twilio/inbound`, HTTP POST.
Outgoing calls need no console setup: the server passes its own TwiML URL, status callback and recording callback on every call.
Make sure the account is upgraded and that Voice Geographic Permissions allow the countries you will call.

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
- A configured voice (`CARTESIA_VOICE_ID`) used for every call, or a per-language voice (`CARTESIA_VOICE_ID_ES`).
- **Languages.** Each payee can have a language (`suppliers.language`, e.g. `es`). A check call to them sets ink-whisper's `language` and Sonic's `language` for that call, speaks the disclosure and every fixed line from a hand-written Spanish table (`voice/src/call/lines.ts`), and has Claude write the questions and clarifications in Spanish. The code safety rules (bank denials, "call me later", leaks, prompt injection) understand Spanish too. Results and summaries stay in English for the team.

Raw websockets (the `ws` package) were chosen over the SDK because barge-in needs exact control: cancel a context, ignore its late chunks, and recover a dropped socket mid-sentence without losing the rest of the reply.

#### How it stays conversational

- **Short turn gaps.** The end of a turn is detected locally: an energy detector on the mu-law frames hears the caller stop, we send `finalize`, and the turn closes 250 ms after the final transcript. Claude's reply is streamed into Sonic as it is generated. Each turn logs `turnGapMs` (end of caller speech to hold's first audio), `thinkMs` (Claude) and `ttsFirstAudioMs` (Sonic) as JSON lines, so a rehearsal can be measured. The target is under 800 ms.
- **Barge-in.** If the caller talks over hold, sustained speech (about 200 ms, so a cough or clap does not count) or a two-word partial transcript stops playback at once: Twilio `clear` empties the phone's audio buffer and the Cartesia context is cancelled. hold then listens, and their words are the next thing it answers.
- **Loud rooms.** The demo phone is on speaker at a busy table. The detector compares each frame with the quietest audio of the last 1.5 s, so steady crowd noise becomes the baseline instead of a trigger. All thresholds are environment knobs (above).
- **Recovery.** If either Cartesia socket drops mid-call it reconnects. Speech-to-text replays up to 2 s of buffered audio; text-to-speech re-sends only the part of the sentence that had not been generated yet, on a fresh context.

#### Calls for any company

hold speaks for whichever company the workspace runs (`lib/company.ts`): the disclosure, the incoming-line greeting, the questions and the summaries use that company's name, team and words ("your upcoming paycheck", "an upcoming disbursement to Pacific Home Loans"). Questions follow a per-company hint: employees are asked about pay dates, their role and manager, never paycheck numbers; home sellers about their property and closing.

- **Phone menus.** A payee's `phoneMenu` (e.g. `ww2`, each `w` a half-second pause) is sent as Twilio `sendDigits` after pickup, so a lender's "press 2 for payoffs" reaches the right desk. Machine detection is off for those calls, since the menu's recorded greeting would read as voicemail.
- **Calling hours.** With `CALLING_HOURS` set, Convex's `claimRequest` refuses to dial outside the payee's weekday hours and schedules the call for the next opening without using up an attempt. The Live call screen shows "Outside their calling hours. Calling Mon 8:00 AM."

#### Known limitations

- Echo: barge-in relies on the caller's phone cancelling hold's own voice. A cheap speakerphone at full volume can leak hold's audio back into its mic and cut it off. Lower the phone volume, or raise `VAD_MARGIN_DB` and `BARGE_IN_MIN_WORDS`.
- A sudden jump in background noise (music starting) can read as speech for up to 1.5 s, until it becomes the new baseline. That can cause one false barge-in.
- If Claude pauses for more than about a second mid-reply, Sonic's context expires; we continue on a new context, which can make a small prosody seam.
- What-was-heard on barge-in is an estimate from playback marks and word timestamps, accurate to roughly a word.
- Transcript times are measured from the start of the media stream; the REST recording starts a few hundred milliseconds later at most, so clips can be off by that much.
- Phone audio is 8 kHz, so names and invoice numbers are sometimes misheard. Questions are written to be answered with amounts and plain words.
- Answering machine detection can misjudge a person on a noisy speakerphone as a machine; set `TWILIO_AMD=false` for the stage demo if that happens.
- If the voice server restarts during a live call, that call is cut and its request stays in "dialing" with no result. Today and the live call page stop treating it (and any stuck "on the line" inbound row) as live once the voice server's heartbeat goes stale (45s) or the call has had no event for 5 minutes, and they show "The phone line is offline" while the server is down — but the stuck row itself still needs a manual follow-up. Avoid editing voice code during a demo (`tsx watch` restarts on save).
- Moss loads its embedding model through onnxruntime, which can crash while Node exits. A clean Ctrl-C can therefore end with exit code 134 after shutdown has finished; calls and data are unaffected.
- The first Moss warm on a new machine downloads a 46 MB embedding model (about 3 minutes). Start the voice server once before the demo so it is cached.
- Only English and Spanish have hand-written call lines. Another language code still sets Cartesia's language and Claude's, but the fixed lines (disclosure, goodbyes) fall back to English.
- The incoming line always answers in English: the caller is unknown until they speak.
- Calling hours assume every zone opens on the hour; a half-hour zone opens up to 30 minutes late.

### Moss

Moss is hold's memory of every supplier: one shared index (`fogline-suppliers`) of each supplier's invoices, payments, past calls, onboarding facts and emails, every query filtered to one supplier. Bank account numbers are never indexed. The voice server loads the index into memory at startup, so searches run locally with no network round trip.

hold is the agent that knows each supplier the way a long-serving bookkeeper does: what they bill, how they write, how they get paid, what they said on the last call. That knowledge spans the company's inbox, its bank and its phone line, and it lives in Moss.

**Memory that stays current.** The voice server subscribes to each supplier's history in Convex (`voice/src/memory.ts`). When an email or bill lands, a payment goes out or a check call finishes, that supplier is re-indexed a couple of seconds later, so the next call, lookup or writing-style check already knows about it. On startup it compares every supplier in Convex with what Moss holds and catches up any that fell behind, including suppliers onboarded since the last start. Each update logs `moss memory updated` with the record count and time. The index reloads in place after a write; queries keep running from the old copy meanwhile (measured: 4–11 ms during a 1.4 s reload), so a live call never waits on it.

**Live, on every answer.** When the supplier answers a check-call question, hold searches their history with their own words while it says "thanks" (`answerLookup` in `voice/src/call/outbound.ts`). The records the answer sounds like go to two places, and never into anything said on the call:
- hold's mid-call check: an answer that doesn't fit the record asked about, but clearly describes another real one (a supplier mixing up July's invoice with June's), counts as unsure, so it goes to the approver instead of failing.
- The approver's prompt on the Live call screen, as "Sounds like: invoice #4134, 2026-06-26: …", so they can decide in seconds while the supplier holds.

Emails are left out of this search: a scammer with mailbox access has read them.

**Before the call.** While the phone rings, Moss finds the invoices, payments and calls the questions are built from.

**Writing style.** The bill check compares a new email with the supplier's past emails pulled from the same index.

**Measured** against the Fogline index on a laptop: a lookup takes 3.2 ms median, 7 ms at the 90th percentile (30 queries of caller-style speech). It runs during the acknowledgement, so it adds nothing to the turn gap. Each lookup logs a `moss lookup` JSON line with `mossMs`.

Limits: Moss always returns its top matches, even for an evasive answer, so the check is told to treat evasive answers as no match. Spoken numbers ("forty four seventy one") rank less well than digits.
<!-- END voice section -->
