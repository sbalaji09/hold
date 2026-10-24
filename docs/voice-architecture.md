# Voice architecture

This is the build map for the voice half of Callback (see `plan-voice.md`).
Interfaces are fixed in code; change them only deliberately and update every user.

## Layout

| Path | Owns |
|---|---|
| `shared/contract.ts` | Contract types and fixed phrases (disclosure, greeting, callback promise). |
| `shared/search.ts` | `SupplierSearch` interface (Moss). Implementation in `shared/mossSearch.ts`. |
| `convex/schema.ts` | The app person's schema. Voice adds only optional fields and wider unions to `callRequests`, `callEvents`, `callResults` and `inboundCalls`. |
| `convex/voice/*.ts` | Convex functions: voice-server API (secret-gated), UI queries, `styleMatch`, Moss indexing, retry scheduling. |
| `convex/voice/records.ts` | The only reader of the app's supplier data (`suppliers`, `bills`, `emails`, `payments`, past calls), mapped to `SupplierProfile` / `SupplierRecord`. |
| `voice/src/store/` | `VoiceStore` interface and its Convex implementation. |
| `voice/src/audio/` | Twilio Media Streams, Cartesia STT and TTS websockets, barge-in, `PhoneTransport`. |
| `voice/src/call/` | Conversation logic: outbound check call, inbound line, question building, judging, simulated supplier. |
| `voice/src/server.ts`, `voice/src/dialer.ts`, `voice/src/main.ts` | HTTP and websocket server, Twilio webhooks, dialing loop. |
| `web/src/voice/` | Live call screen, Phone line screen, auto-open hook. |

## Flow: outgoing check call

1. The app inserts a `callRequests` row with status `queued`.
2. The dialer (subscribed to queued rows) pre-warms Moss and runs `prepareOutboundCall` to build 1-3 questions.
   Then it calls `claimRequest`, which atomically moves the row to `dialing` and increments `attempt`.
3. Live mode: Twilio `calls.create` with status callbacks and async answering-machine detection.
   Simulated mode: `SimulatedTransport` with a Claude-played supplier, and no phone.
4. On answer, Twilio opens a Media Stream (mulaw 8 kHz).
   `PhoneTransport` bridges audio to Cartesia STT (ink-whisper) and Sonic TTS, with barge-in.
   Recording starts via the REST API when the stream starts, so `ts` 0 equals recording 0 s.
5. `runOutboundCall` says the disclosure, asks the questions, writes `segment` / `question` events, judges the answers and calls `finishCall`.
6. No answer, busy, failed or voicemail: `reportNoAnswer`. Convex schedules one retry or hands off.
   A stream that closes before the session finishes is `dropped`, which leads to `handed_off` with whatever evidence was actually heard.
7. The recording-status webhook downloads the recording from Twilio and calls `attachRecording`.

## Flow: incoming line

Twilio number voice webhook, then TwiML `<Connect><Stream>`, then `PhoneTransport`, then `runInboundCall`.
It never changes or reads back anything.
On a bank-change request, `finishInboundCall` creates a call request to the supplier's `phone_on_file`.

## Security

- Voice-server mutations take `secret` and compare it to the `VOICE_SERVER_SECRET` Convex env var.
- Twilio webhooks check `X-Twilio-Signature`. The media websocket takes a per-call HMAC token passed as a stream parameter.
- No keys in the repo. See `.env.example`.
