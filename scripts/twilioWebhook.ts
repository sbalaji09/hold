// Points Fogline's Twilio number at the voice server's inbound webhook, by hand.
// The voice server does this itself on startup when TWILIO_POINT_WEBHOOK=true.
//   npx tsx --env-file=.env scripts/twilioWebhook.ts
import { pointNumberAt } from "../voice/src/audio/twilio.js";

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, NGROK_DOMAIN } = process.env;
const base = process.env.PUBLIC_BASE_URL || (NGROK_DOMAIN && `https://${NGROK_DOMAIN}`);
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !base) {
  throw new Error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and PUBLIC_BASE_URL (or NGROK_DOMAIN) must be set");
}
const { voiceUrl, previous } = await pointNumberAt(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, base);
console.log(`${TWILIO_PHONE_NUMBER}: incoming calls -> POST ${voiceUrl} (was ${previous ?? "unset"})`);
