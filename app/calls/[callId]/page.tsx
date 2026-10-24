"use client";
import { use } from "react";
import { LiveCallScreen } from "@/components/voice";

export default function LiveCallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = use(params);
  return <LiveCallScreen key={callId} callId={decodeURIComponent(callId)} />;
}
