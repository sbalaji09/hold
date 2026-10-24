import { LiveCallScreen } from "@/components/voice";
import { getPersona } from "@/lib/persona";

export default async function LiveCallPage({ params }: { params: Promise<{ callId: string }> }) {
  const [{ callId }, actor] = await Promise.all([params, getPersona()]);
  return <LiveCallScreen key={callId} callId={decodeURIComponent(callId)} actor={actor} />;
}
