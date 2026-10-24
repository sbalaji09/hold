// Points Fogline's Twilio number at this voice server's inbound webhook.
// Re-run whenever PUBLIC_BASE_URL changes (a free ngrok URL changes on every restart):
//   npx tsx --env-file=.env scripts/twilioWebhook.ts
import twilio from "twilio";

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, PUBLIC_BASE_URL } = process.env;
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !PUBLIC_BASE_URL) {
  throw new Error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and PUBLIC_BASE_URL must be set");
}
const voiceUrl = `${PUBLIC_BASE_URL.replace(/\/+$/, "")}/twilio/inbound`;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const [number] = await client.incomingPhoneNumbers.list({ phoneNumber: TWILIO_PHONE_NUMBER, limit: 1 });
if (!number) throw new Error(`${TWILIO_PHONE_NUMBER} is not a number on this Twilio account`);

// Clearing voiceApplicationSid matters: an attached TwiML app would silently override voiceUrl.
await client.incomingPhoneNumbers(number.sid).update({ voiceUrl, voiceMethod: "POST", voiceApplicationSid: "" });
console.log(`${number.phoneNumber}: incoming calls -> POST ${voiceUrl} (was ${number.voiceUrl || "unset"})`);
