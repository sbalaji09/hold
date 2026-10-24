import { LiveCallScreen } from "@/components/voice";

export default async function LiveCallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  return <LiveCallScreen key={callId} callId={decodeURIComponent(callId)} />;
}
